using System;
using System.Runtime.InteropServices;

namespace StructValidator.Memory;

/// <summary>
/// Safe memory reading utilities with proper error handling.
/// Uses VirtualQuery to verify memory is readable before access.
/// </summary>
public static unsafe class SafeMemoryReader
{
    private const int MaxReadSize = 0x100000; // 1MB limit

    // Memory protection constants
    private const uint PAGE_NOACCESS = 0x01;
    private const uint PAGE_GUARD = 0x100;

    [StructLayout(LayoutKind.Sequential)]
    private struct MEMORY_BASIC_INFORMATION
    {
        public nint BaseAddress;
        public nint AllocationBase;
        public uint AllocationProtect;
        public nint RegionSize;
        public uint State;
        public uint Protect;
        public uint Type;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern nint VirtualQuery(nint lpAddress, out MEMORY_BASIC_INFORMATION lpBuffer, nint dwLength);

    /// <summary>
    /// Check if a memory region is readable using VirtualQuery.
    /// </summary>
    public static bool IsMemoryReadable(nint address, int size = 1)
    {
        if (address == 0 || size <= 0)
            return false;

        try
        {
            var result = VirtualQuery(address, out var mbi, (nint)Marshal.SizeOf<MEMORY_BASIC_INFORMATION>());
            if (result == 0)
                return false;

            // Check if memory is committed and readable
            const uint MEM_COMMIT = 0x1000;
            if (mbi.State != MEM_COMMIT)
                return false;

            // Check protection flags - must not be NOACCESS or GUARD
            if ((mbi.Protect & PAGE_NOACCESS) != 0 || (mbi.Protect & PAGE_GUARD) != 0)
                return false;

            // Check that the entire region we want to read is within this block
            var regionEnd = (ulong)mbi.BaseAddress + (ulong)mbi.RegionSize;
            var readEnd = (ulong)address + (ulong)size;
            if (readEnd > regionEnd)
                return false;

            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Try to read bytes from memory safely.
    /// </summary>
    public static bool TryReadBytes(nint address, int size, out byte[] buffer)
    {
        buffer = Array.Empty<byte>();

        if (address == 0 || size <= 0 || size > MaxReadSize)
            return false;

        if (!IsMemoryReadable(address, size))
            return false;

        try
        {
            buffer = new byte[size];
            Marshal.Copy(address, buffer, 0, size);
            return true;
        }
        catch
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
        if (!IsMemoryReadable(address, 8))
            return false;

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
        if (!IsMemoryReadable(address, 4))
            return false;

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
        if (!IsMemoryReadable(address, 4))
            return false;

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
        if (!IsMemoryReadable(address, 4))
            return false;

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
        if (!IsMemoryReadable(address, 1))
            return false;

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
        if (!IsMemoryReadable(address, 2))
            return false;

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
        if (!IsMemoryReadable(address, 8))
            return false;

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
        return IsMemoryReadable(address, 1);
    }
}
