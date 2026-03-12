namespace ChromaHash;

internal static class BitPack
{
    /// <summary>Write count bits of value starting at bitpos in little-endian byte order. Per spec §12.7 writeBits.</summary>
    public static void WriteBits(byte[] hash, int bitpos, int count, uint value)
    {
        for (int i = 0; i < count; i++)
        {
            int byteIdx = (bitpos + i) / 8;
            int bitIdx = (bitpos + i) % 8;
            if (((value >> i) & 1) != 0)
                hash[byteIdx] |= (byte)(1 << bitIdx);
        }
    }

    /// <summary>Read count bits starting at bitpos in little-endian byte order. Per spec §12.7 readBits.</summary>
    public static uint ReadBits(byte[] hash, int bitpos, int count)
    {
        uint value = 0;
        for (int i = 0; i < count; i++)
        {
            int byteIdx = (bitpos + i) / 8;
            int bitIdx = (bitpos + i) % 8;
            if ((hash[byteIdx] & (1 << bitIdx)) != 0)
                value |= (1u << i);
        }
        return value;
    }
}
