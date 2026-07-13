import {
  metadataToScVal, scValToMetadata,
  toScValAddress, toScValOption,
} from './payments';

test('converts flat metadata to SCVal map and back', () => {
  const meta = { ref: 'INV-001', amount: 42, verified: true };
  const scVal  = metadataToScVal(meta);
  const result = scValToMetadata(scVal);
  expect(result.ref).toBe('INV-001');
  expect(result.verified).toBe(true);
});

test('throws on non-finite number in metadata', () => {
  expect(() => metadataToScVal({ bad: Infinity })).toThrow('finite number');
});

test('throws on invalid Stellar address', () => {
  expect(() => toScValAddress('not-an-address')).toThrow('SCVal address');
});

test('toScValOption returns void for null', () => {
  const opt = toScValOption(null);
  expect(opt.switch().name).toBe('scvVoid');
});

test('toScValOption wraps a value in Some', () => {
  const inner = toScValOption(null); // void as placeholder
  const opt   = toScValOption(inner);
  expect(opt.switch().name).toBe('scvVec');
});