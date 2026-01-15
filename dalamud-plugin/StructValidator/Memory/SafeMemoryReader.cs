using System;
using System.Runtime.InteropServices;

namespace StructValidator.Memory;

/// <summary>
/// Safe memory reading utilities with proper error handling.
/// </summary>
public static unsafe class SafeMemoryReader
{
    private const int MaxReadSize = 0x100000; // 1MB limit

    /// <summary>
    /// Try to read bytes from memory safely.
    /// </summary>
    public static bool TryReadBytes(nint address, int size, out byte[] buffer)
    {
        buffer = Array.Empty<byte>();

        if (address == 0 || size <= 0 || size > MaxReadSize)
            return false;

        try
        {
            buffer = new byte[size];
            Marshal.Copy(address, buffer, 0, size);
            return true;
        }
        catch (AccessViolationException)
        {
            return false;
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>
    /// Read bytes from memory, returning empty array on failure.
    /// </summary>
    public static byte[] ReadBytes(nint address, int size)
    {
        return TryReadBytes(address, size, out var buffer) ? buffer : Array.Empty<byte>();
    }

    /// <summary>
    /// Try to read an 8-byte pointer value.
    /// </summary>
    public static bool TryReadPointer(nint address, out nint value)
    {
        value = 0;
        if (address == 0) return false;

        try
        {
            value = *(nint*)address;
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Try to read a 4-byte integer.
    /// </summary>
    public static bool TryReadInt32(nint address, out int value)
    {
        value = 0;
        if (address == 0) return false;

        try
        {
            value = *(int*)address;
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Try to read a 4-byte unsigned integer.
    /// </summary>
    public static bool TryReadUInt32(nint address, out uint value)
    {
        value = 0;
        if (address == 0) return false;

        try
        {
            value = *(uint*)address;
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Try to read a 4-byte float.
    /// </summary>
    public static bool TryReadFloat(nint address, out float value)
    {
        value = 0;
        if (address == 0) return false;

        try
        {
            value = *(float*)address;
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Try to read a single byte.
    /// </summary>
    public static bool TryReadByte(nint address, out byte value)
    {
        value = 0;
        if (address == 0) return false;

        try
        {
            value = *(byte*)address;
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Try to read a 2-byte short.
    /// </summary>
    public static bool TryReadInt16(nint address, out short value)
    {
        value = 0;
        if (address == 0) return false;

        try
        {
            value = *(short*)address;
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Try to read an 8-byte long.
    /// </summary>
    public static bool TryReadInt64(nint address, out long value)
    {
        value = 0;
        if (address == 0) return false;

        try
        {
            value = *(long*)address;
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Check if an address is likely readable (basic heuristic).
    /// </summary>
    public static bool IsReadable(nint address)
    {
        if (address == 0) return false;

        try
        {
            // Try to read a single byte
            _ = *(byte*)address;
            return true;
        }
        catch
        {
            return false;
        }
    }
}
