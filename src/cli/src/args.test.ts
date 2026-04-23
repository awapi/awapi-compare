import { describe, expect, it } from 'vitest';
import { parseCliArgs } from './args.js';

describe('parseCliArgs', () => {
  it('parses two positional paths with defaults', () => {
    const r = parseCliArgs(['./a', './b']);
    expect(r).toEqual({ left: './a', right: './b', mode: 'quick', rulesFile: undefined });
  });

  it('accepts --mode thorough', () => {
    expect(parseCliArgs(['--mode', 'thorough', 'a', 'b']).mode).toBe('thorough');
    expect(parseCliArgs(['a', 'b', '--mode=binary']).mode).toBe('binary');
  });

  it('accepts --rules file', () => {
    expect(parseCliArgs(['a', 'b', '--rules', 'r.json']).rulesFile).toBe('r.json');
    expect(parseCliArgs(['--rules=r.json', 'a', 'b']).rulesFile).toBe('r.json');
  });

  it('rejects unknown options', () => {
    expect(() => parseCliArgs(['a', 'b', '--nope'])).toThrow(/Unknown option/);
  });

  it('rejects invalid --mode value', () => {
    expect(() => parseCliArgs(['a', 'b', '--mode', 'fuzzy'])).toThrow(/--mode/);
  });

  it('requires exactly two positional args', () => {
    expect(() => parseCliArgs(['only-one'])).toThrow(/two positional/);
    expect(() => parseCliArgs(['a', 'b', 'c'])).toThrow(/two positional/);
  });

  it('requires a value for --rules', () => {
    expect(() => parseCliArgs(['a', 'b', '--rules'])).toThrow(/--rules/);
  });
});
