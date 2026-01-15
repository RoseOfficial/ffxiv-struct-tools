using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Xml;
using StructValidator.Discovery;
using StructValidator.Memory;

namespace StructValidator.Services;

/// <summary>
/// Exports struct layouts to ReClass.NET XML format (.rcnet).
/// This allows discovered layouts to be opened and edited in ReClass.NET.
/// </summary>
public class ReClassExporter
{
    /// <summary>
    /// Export a single layout to ReClass.NET XML format.
    /// </summary>
    public string ExportToRcnet(DiscoveredLayout layout)
    {
        return ExportProjectToRcnet(new[] { layout }, layout.StructName);
    }

    /// <summary>
    /// Export multiple layouts as a ReClass.NET project.
    /// </summary>
    public string ExportProjectToRcnet(IEnumerable<DiscoveredLayout> layouts, string projectName)
    {
        var sb = new StringBuilder();
        var settings = new XmlWriterSettings
        {
            Indent = true,
            IndentChars = "  ",
            OmitXmlDeclaration = false,
            Encoding = Encoding.UTF8
        };

        using (var writer = XmlWriter.Create(sb, settings))
        {
            writer.WriteStartDocument();
            writer.WriteStartElement("ReClassNet");

            // Write type mapping
            WriteTypeMapping(writer);

            // Write custom data (metadata)
            writer.WriteStartElement("CustomData");
            writer.WriteElementString("Generator", "StructValidator Plugin");
            writer.WriteElementString("GeneratedAt", DateTime.UtcNow.ToString("O"));
            writer.WriteElementString("ProjectName", projectName);
            writer.WriteEndElement(); // CustomData

            // Write classes
            writer.WriteStartElement("Classes");

            foreach (var layout in layouts)
            {
                WriteClass(writer, layout);
            }

            writer.WriteEndElement(); // Classes

            writer.WriteEndElement(); // ReClassNet
            writer.WriteEndDocument();
        }

        return sb.ToString();
    }

    private void WriteTypeMapping(XmlWriter writer)
    {
        writer.WriteStartElement("TypeMapping");

        // Standard ReClass.NET type mappings
        var mappings = new Dictionary<string, string>
        {
            { "Bool", "BoolNode" },
            { "Int8", "Int8Node" },
            { "Int16", "Int16Node" },
            { "Int32", "Int32Node" },
            { "Int64", "Int64Node" },
            { "UInt8", "UInt8Node" },
            { "UInt16", "UInt16Node" },
            { "UInt32", "UInt32Node" },
            { "UInt64", "UInt64Node" },
            { "Float", "FloatNode" },
            { "Double", "DoubleNode" },
            { "Pointer", "PointerNode" },
            { "Utf8Text", "Utf8TextNode" },
            { "Utf16Text", "Utf16TextNode" },
            { "Hex8", "Hex8Node" },
            { "Hex16", "Hex16Node" },
            { "Hex32", "Hex32Node" },
            { "Hex64", "Hex64Node" },
            { "Vector2", "Vector2Node" },
            { "Vector3", "Vector3Node" },
            { "Vector4", "Vector4Node" },
            { "VTable", "VirtualMethodTableNode" },
            { "FunctionPtr", "FunctionPtrNode" },
            { "ClassInstance", "ClassInstanceNode" },
            { "Array", "ArrayNode" },
        };

        foreach (var mapping in mappings)
        {
            writer.WriteStartElement("TypeMap");
            writer.WriteAttributeString("Type", mapping.Key);
            writer.WriteAttributeString("NodeType", mapping.Value);
            writer.WriteEndElement();
        }

        writer.WriteEndElement(); // TypeMapping
    }

    private void WriteClass(XmlWriter writer, DiscoveredLayout layout)
    {
        var className = GetSafeClassName(layout.StructName);

        writer.WriteStartElement("Class");
        writer.WriteAttributeString("Name", className);
        writer.WriteAttributeString("Comment", $"From FFXIVClientStructs - Address: {layout.BaseAddressHex}");
        writer.WriteAttributeString("Address", layout.BaseAddressHex);

        // Write nodes (fields)
        foreach (var field in layout.Fields)
        {
            WriteNode(writer, field);
        }

        writer.WriteEndElement(); // Class
    }

    private void WriteNode(XmlWriter writer, DiscoveredField field)
    {
        var nodeType = MapToReClassNodeType(field);
        var nodeName = GetNodeName(field);

        writer.WriteStartElement("Node");
        writer.WriteAttributeString("Name", nodeName);
        writer.WriteAttributeString("Type", nodeType);
        writer.WriteAttributeString("Offset", $"0x{field.Offset:X}");
        writer.WriteAttributeString("Size", field.Size.ToString());

        // Add comment with declared info if available
        var comment = BuildNodeComment(field);
        if (!string.IsNullOrEmpty(comment))
        {
            writer.WriteAttributeString("Comment", comment);
        }

        // For arrays, add count
        if (field.InferredType == InferredTypeKind.Array && field.Size > 1)
        {
            writer.WriteAttributeString("Count", field.Size.ToString());
        }

        writer.WriteEndElement(); // Node
    }

    private string MapToReClassNodeType(DiscoveredField field)
    {
        // If we have a declared type, try to map it
        if (field.HasMatch && !string.IsNullOrEmpty(field.DeclaredType))
        {
            var declaredType = field.DeclaredType.ToLowerInvariant();

            // Handle pointers
            if (declaredType.Contains("*") || declaredType.Contains("pointer"))
                return "Pointer";

            // Handle vectors
            if (declaredType.Contains("vector3"))
                return "Vector3";
            if (declaredType.Contains("vector2"))
                return "Vector2";
            if (declaredType.Contains("vector4") || declaredType.Contains("quaternion"))
                return "Vector4";

            // Handle strings
            if (declaredType.Contains("utf8string") || declaredType.Contains("sestring"))
                return "ClassInstance"; // Utf8String is a struct, not raw text

            // Handle common types
            if (declaredType == "bool" || declaredType == "boolean")
                return "Bool";
            if (declaredType == "byte" || declaredType == "uint8")
                return "UInt8";
            if (declaredType == "sbyte" || declaredType == "int8")
                return "Int8";
            if (declaredType == "short" || declaredType == "int16")
                return "Int16";
            if (declaredType == "ushort" || declaredType == "uint16")
                return "UInt16";
            if (declaredType == "int" || declaredType == "int32")
                return "Int32";
            if (declaredType == "uint" || declaredType == "uint32")
                return "UInt32";
            if (declaredType == "long" || declaredType == "int64")
                return "Int64";
            if (declaredType == "ulong" || declaredType == "uint64")
                return "UInt64";
            if (declaredType == "float" || declaredType == "single")
                return "Float";
            if (declaredType == "double")
                return "Double";
        }

        // Fall back to inferred type mapping
        return field.InferredType switch
        {
            InferredTypeKind.VTablePointer => "VTable",
            InferredTypeKind.Pointer => "Pointer",
            InferredTypeKind.StringPointer => "Pointer",
            InferredTypeKind.Utf8String => "ClassInstance",
            InferredTypeKind.Float => "Float",
            InferredTypeKind.Double => "Double",
            InferredTypeKind.Bool => "Bool",
            InferredTypeKind.Byte => "Hex8",
            InferredTypeKind.Int16 => "Hex16",
            InferredTypeKind.Int32 => "Hex32",
            InferredTypeKind.Int64 => "Hex64",
            InferredTypeKind.Enum => "Hex32",
            InferredTypeKind.Padding => "Hex8",
            InferredTypeKind.Array => "Array",
            InferredTypeKind.Struct => "ClassInstance",
            _ => GetHexTypeForSize(field.Size)
        };
    }

    private string GetHexTypeForSize(int size)
    {
        return size switch
        {
            1 => "Hex8",
            2 => "Hex16",
            4 => "Hex32",
            8 => "Hex64",
            _ => "Hex8"
        };
    }

    private string GetNodeName(DiscoveredField field)
    {
        if (field.HasMatch && !string.IsNullOrEmpty(field.DeclaredName))
        {
            return field.DeclaredName;
        }

        // Generate name based on type and offset
        var prefix = field.InferredType switch
        {
            InferredTypeKind.VTablePointer => "vtable",
            InferredTypeKind.Pointer => "ptr",
            InferredTypeKind.StringPointer => "str",
            InferredTypeKind.Float => "flt",
            InferredTypeKind.Bool => "b",
            InferredTypeKind.Padding => "pad",
            _ => "unk"
        };

        return $"{prefix}_{field.Offset:X}";
    }

    private string BuildNodeComment(DiscoveredField field)
    {
        var parts = new List<string>();

        if (field.HasMatch)
        {
            if (!string.IsNullOrEmpty(field.DeclaredType))
            {
                parts.Add($"Declared: {field.DeclaredType}");
            }
        }
        else
        {
            parts.Add("Undocumented");
        }

        return string.Join(" | ", parts);
    }

    private string GetSafeClassName(string structName)
    {
        // Extract just the class name from full namespace path
        var parts = structName.Split('.', '+');
        var name = parts.LastOrDefault() ?? "Unknown";

        // Remove invalid characters
        return new string(name.Where(c => char.IsLetterOrDigit(c) || c == '_').ToArray());
    }
}
