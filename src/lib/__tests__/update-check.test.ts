import { describe, it, expect } from 'vitest';
import { isNewer } from '../update-check';

describe('isNewer', () => {
  it('bản mới hơn thì true', () => {
    expect(isNewer('0.2.0', '0.1.2')).toBe(true);
    expect(isNewer('0.1.3', '0.1.2')).toBe(true);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
  });

  it('bằng hoặc cũ hơn thì false', () => {
    expect(isNewer('0.1.2', '0.1.2')).toBe(false);
    expect(isNewer('0.1.1', '0.1.2')).toBe(false);
    expect(isNewer('0.1.10', '0.1.9')).toBe(true);
  });
});
