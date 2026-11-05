import { describe, expect, it } from 'vitest';
import { activeHref } from './Sidebar';

const HREFS = ['/projects', '/projects/settings', '/system', '/'];

describe('activeHref', () => {
  it('highlights only the nested item on /projects/settings', () => {
    expect(activeHref('/projects/settings', HREFS)).toBe('/projects/settings');
  });
  it('highlights the parent on /projects and on its other children', () => {
    expect(activeHref('/projects', HREFS)).toBe('/projects');
    expect(activeHref('/projects/abc', HREFS)).toBe('/projects');
  });
  it('does not match a sibling that only shares a prefix', () => {
    expect(activeHref('/systemx', HREFS)).toBe(null);
  });
});
