import { describe, it, expect } from 'vitest';
import {
  parseOffset,
  toHex,
  isPointerType,
  isArrayType,
  extractBaseType,
} from '../types.js';

describe('parseOffset', () => {
  it('should parse decimal numbers', () => {
    expect(parseOffset(42)).toBe(42);
    expect(parseOffset('42')).toBe(42);
  });

  it('should parse hex strings', () => {
    expect(parseOffset('0x10')).toBe(16);
    expect(parseOffset('0X10')).toBe(16);
    expect(parseOffset('0xFF')).toBe(255);
  });

  it('should return 0 for undefined', () => {
    expect(parseOffset(undefined)).toBe(0);
  });
});

describe('toHex', () => {
  it('should format numbers as hex', () => {
    expect(toHex(0)).toBe('0x0');
    expect(toHex(16)).toBe('0x10');
    expect(toHex(255)).toBe('0xFF');
  });

  it('should support minimum width', () => {
    expect(toHex(1, 4)).toBe('0x0001');
    expect(toHex(16, 4)).toBe('0x0010');
  });
});

describe('isPointerType', () => {
  it('should detect pointer types', () => {
    expect(isPointerType('int*')).toBe(true);
    expect(isPointerType('void*')).toBe(true);
    expect(isPointerType('Pointer<int>')).toBe(true);
    expect(isPointerType('CString')).toBe(true);
  });

  it('should not detect non-pointer types', () => {
    expect(isPointerType('int')).toBe(false);
    expect(isPointerType('float')).toBe(false);
    expect(isPointerType('MyStruct')).toBe(false);
  });
});

describe('isArrayType', () => {
  it('should detect array types', () => {
    expect(isArrayType('int[10]')).toBe(true);
    expect(isArrayType('byte[256]')).toBe(true);
    expect(isArrayType('FixedArray<int, 10>')).toBe(true);
  });

  it('should not detect non-array types', () => {
    expect(isArrayType('int')).toBe(false);
    expect(isArrayType('int*')).toBe(false);
    expect(isArrayType('Pointer<int>')).toBe(false);
  });
});

describe('extractBaseType', () => {
  it('should extract from Pointer<T>', () => {
    expect(extractBaseType('Pointer<int>')).toBe('int');
    expect(extractBaseType('Pointer<MyStruct>')).toBe('MyStruct');
  });

  it('should extract from FixedArray<T, N>', () => {
    expect(extractBaseType('FixedArray<int, 10>')).toBe('int');
    expect(extractBaseType('FixedArray<byte, 256>')).toBe('byte');
  });

  it('should extract from StdVector<T>', () => {
    expect(extractBaseType('StdVector<int>')).toBe('int');
  });

  it('should extract from T*', () => {
    expect(extractBaseType('int*')).toBe('int');
    expect(extractBaseType('MyStruct*')).toBe('MyStruct');
  });

  it('should extract from T[N]', () => {
    expect(extractBaseType('int[10]')).toBe('int');
    expect(extractBaseType('byte[256]')).toBe('byte');
  });

  it('should return type unchanged if not a template/pointer/array', () => {
    expect(extractBaseType('int')).toBe('int');
    expect(extractBaseType('MyStruct')).toBe('MyStruct');
  });
});
