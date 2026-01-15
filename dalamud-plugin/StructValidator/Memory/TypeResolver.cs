using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace StructValidator.Memory;

/// <summary>
/// Resolves FFXIVClientStructs types for memory analysis.
/// </summary>
public static class TypeResolver
{
    private static Assembly? clientStructsAssembly;
    private static List<Type>? cachedStructTypes;
    private static bool initialized;

    // VTable address → Type mapping cache
    private static readonly Dictionary<nint, Type> vtableToTypeCache = new();
    private static bool vtableCacheBuilt;

    /// <summary>
    /// Initialize the type resolver by finding the FFXIVClientStructs assembly.
    /// </summary>
    public static void Initialize()
    {
        if (initialized) return;

        clientStructsAssembly = AppDomain.CurrentDomain.GetAssemblies()
            .FirstOrDefault(a => a.GetName().Name == "FFXIVClientStructs");

        initialized = true;
    }

    /// <summary>
    /// Get all struct types from FFXIVClientStructs.
    /// </summary>
    public static IEnumerable<Type> GetAllStructTypes()
    {
        Initialize();

        if (cachedStructTypes != null)
            return cachedStructTypes;

        if (clientStructsAssembly == null)
            return Enumerable.Empty<Type>();

        try
        {
            cachedStructTypes = clientStructsAssembly.GetTypes()
                .Where(t => t.IsValueType &&
                           !t.IsEnum &&
                           t.Namespace?.StartsWith("FFXIVClientStructs") == true &&
                           t.GetCustomAttribute<StructLayoutAttribute>() != null)
                .OrderBy(t => t.FullName)
                .ToList();

            return cachedStructTypes;
        }
        catch (ReflectionTypeLoadException ex)
        {
            cachedStructTypes = ex.Types
                .Where(t => t != null &&
                           t.IsValueType &&
                           !t.IsEnum &&
                           t.Namespace?.StartsWith("FFXIVClientStructs") == true &&
                           t.GetCustomAttribute<StructLayoutAttribute>() != null)
                .Cast<Type>()
                .OrderBy(t => t.FullName)
                .ToList();

            return cachedStructTypes;
        }
    }

    /// <summary>
    /// Find a type by its full name.
    /// </summary>
    public static Type? FindType(string fullName)
    {
        Initialize();
        return clientStructsAssembly?.GetType(fullName);
    }

    /// <summary>
    /// Find types matching a short name.
    /// </summary>
    public static IEnumerable<Type> FindTypesByName(string shortName)
    {
        return GetAllStructTypes()
            .Where(t => t.Name.Equals(shortName, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Get the declared size for a type from StructLayoutAttribute.
    /// </summary>
    public static int? GetDeclaredSize(Type type)
    {
        var layoutAttr = type.GetCustomAttribute<StructLayoutAttribute>();
        return layoutAttr?.Size > 0 ? layoutAttr.Size : null;
    }

    /// <summary>
    /// Get all declared fields for a type with their offsets.
    /// </summary>
    public static IEnumerable<(string Name, int Offset, Type FieldType, int? Size)> GetDeclaredFields(Type type)
    {
        var fields = new List<(string, int, Type, int?)>();
        var currentType = type;

        while (currentType != null && currentType != typeof(object) && currentType != typeof(ValueType))
        {
            foreach (var field in currentType.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly))
            {
                var offsetAttr = field.GetCustomAttribute<FieldOffsetAttribute>();
                if (offsetAttr != null)
                {
                    int? size = null;
                    try
                    {
                        size = Marshal.SizeOf(field.FieldType);
                    }
                    catch { }

                    fields.Add((field.Name, offsetAttr.Value, field.FieldType, size));
                }
            }
            currentType = currentType.BaseType;
        }

        return fields.OrderBy(f => f.Item2);
    }

    /// <summary>
    /// Try to resolve a type from a pointer type string like "Character*" or "Pointer&lt;Character&gt;".
    /// </summary>
    public static Type? ResolvePointerTargetType(string? pointerTypeString)
    {
        if (string.IsNullOrEmpty(pointerTypeString))
            return null;

        // Match patterns like "Character*", "Pointer<Character>", "StdVector<Character>"
        var match = Regex.Match(pointerTypeString, @"(?:Pointer<|StdVector<|)(\w+)(?:>|\*)?");
        if (!match.Success)
            return null;

        var typeName = match.Groups[1].Value;

        // Skip primitive types
        if (IsPrimitiveTypeName(typeName))
            return null;

        // Try to find the type
        var candidates = FindTypesByName(typeName).ToList();
        return candidates.Count == 1 ? candidates[0] : candidates.FirstOrDefault();
    }

    /// <summary>
    /// Try to resolve a type by checking if the memory at the address has a vtable
    /// that matches a known type.
    /// </summary>
    public static Type? ResolveFromVTable(nint address)
    {
        // Read vtable pointer at offset 0
        if (!SafeMemoryReader.TryReadPointer(address, out var vtable) || vtable == 0)
            return null;

        // Look up in our cache
        if (vtableToTypeCache.TryGetValue(vtable, out var type))
            return type;

        return null;
    }

    /// <summary>
    /// Build the vtable→type cache by iterating all singleton types.
    /// Call this during plugin initialization.
    /// </summary>
    public static int BuildVTableCache()
    {
        if (vtableCacheBuilt)
            return vtableToTypeCache.Count;

        Initialize();

        if (clientStructsAssembly == null)
            return 0;

        int added = 0;

        try
        {
            // Find all types with Instance() methods
            var singletonTypes = GetSingletonTypes().ToList();

            foreach (var type in singletonTypes)
            {
                try
                {
                    var ptr = GetInstancePointer(type);
                    if (ptr == 0)
                        continue;

                    // Read vtable pointer at offset 0
                    if (!SafeMemoryReader.TryReadPointer(ptr, out var vtableAddr) || vtableAddr == 0)
                        continue;

                    // Only add if we haven't seen this vtable yet
                    if (!vtableToTypeCache.ContainsKey(vtableAddr))
                    {
                        vtableToTypeCache[vtableAddr] = type;
                        added++;
                    }
                }
                catch
                {
                    // Skip types that fail
                }
            }
        }
        catch
        {
            // Ignore errors during cache building
        }

        vtableCacheBuilt = true;
        return added;
    }

    /// <summary>
    /// Get all types with static Instance() methods (singletons).
    /// </summary>
    public static IEnumerable<Type> GetSingletonTypes()
    {
        Initialize();

        if (clientStructsAssembly == null)
            return Enumerable.Empty<Type>();

        try
        {
            return clientStructsAssembly.GetTypes()
                .Where(t => t.Namespace?.StartsWith("FFXIVClientStructs") == true &&
                           t.GetMethod("Instance", BindingFlags.Static | BindingFlags.Public) != null)
                .OrderBy(t => t.FullName);
        }
        catch (ReflectionTypeLoadException ex)
        {
            return ex.Types
                .Where(t => t != null &&
                           t.Namespace?.StartsWith("FFXIVClientStructs") == true &&
                           t.GetMethod("Instance", BindingFlags.Static | BindingFlags.Public) != null)!
                .Cast<Type>()
                .OrderBy(t => t.FullName);
        }
    }

    /// <summary>
    /// Get the instance pointer for a singleton type.
    /// </summary>
    private static nint GetInstancePointer(Type type)
    {
        var instanceMethod = type.GetMethod("Instance", BindingFlags.Static | BindingFlags.Public);
        if (instanceMethod == null)
            return 0;

        try
        {
            var returnType = instanceMethod.ReturnType;

            if (returnType.IsPointer)
            {
                // Create delegate and call it
                var del = Delegate.CreateDelegate(typeof(Func<nint>), instanceMethod, false);
                if (del != null)
                    return ((Func<nint>)del)();

                // Fallback: use function pointer
                var funcPtr = instanceMethod.MethodHandle.GetFunctionPointer();
                unsafe
                {
                    var func = (delegate* unmanaged<nint>)funcPtr;
                    return func();
                }
            }
            else
            {
                // Non-pointer return - try to extract pointer value
                var result = instanceMethod.Invoke(null, null);
                return ExtractPointerValue(result);
            }
        }
        catch
        {
            return 0;
        }
    }

    /// <summary>
    /// Extract pointer value from various wrapper types.
    /// </summary>
    private static nint ExtractPointerValue(object? value)
    {
        if (value == null)
            return 0;

        var valueType = value.GetType();

        if (valueType == typeof(nint) || valueType == typeof(IntPtr))
            return (nint)value;

        if (valueType == typeof(nuint) || valueType == typeof(UIntPtr))
            return (nint)(nuint)value;

        // Try Pointer<T>.Value property
        var valueProperty = valueType.GetProperty("Value");
        if (valueProperty != null)
        {
            var ptrValue = valueProperty.GetValue(value);
            return ExtractPointerValue(ptrValue);
        }

        return 0;
    }

    /// <summary>
    /// Get the number of cached vtable mappings.
    /// </summary>
    public static int GetVTableCacheCount() => vtableToTypeCache.Count;

    /// <summary>
    /// Check if a vtable address is in the cache.
    /// </summary>
    public static bool IsVTableKnown(nint vtableAddress) => vtableToTypeCache.ContainsKey(vtableAddress);

    /// <summary>
    /// Clear the vtable cache (useful for refreshing after game updates).
    /// </summary>
    public static void ClearVTableCache()
    {
        vtableToTypeCache.Clear();
        vtableCacheBuilt = false;
    }

    /// <summary>
    /// Get a display-friendly type name.
    /// </summary>
    public static string GetDisplayTypeName(Type type)
    {
        if (type.IsPointer)
        {
            var elementType = type.GetElementType();
            return elementType != null ? $"{elementType.Name}*" : "void*";
        }

        if (type.IsGenericType)
        {
            var genericName = type.Name;
            var backtickIndex = genericName.IndexOf('`');
            if (backtickIndex > 0)
                genericName = genericName[..backtickIndex];

            var args = string.Join(", ", type.GetGenericArguments().Select(GetDisplayTypeName));
            return $"{genericName}<{args}>";
        }

        return type.Name;
    }

    private static bool IsPrimitiveTypeName(string name)
    {
        return name switch
        {
            "byte" or "Byte" or "sbyte" or "SByte" => true,
            "short" or "Int16" or "ushort" or "UInt16" => true,
            "int" or "Int32" or "uint" or "UInt32" => true,
            "long" or "Int64" or "ulong" or "UInt64" => true,
            "float" or "Single" or "double" or "Double" => true,
            "bool" or "Boolean" => true,
            "void" or "nint" or "nuint" or "IntPtr" or "UIntPtr" => true,
            _ => false
        };
    }
}
