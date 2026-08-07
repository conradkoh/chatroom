import { describe, expect, it } from 'vitest';

import {
  DESKTOP_PICKER_CHILDREN_WRAPPER_CLASSNAME,
  MOBILE_DRAWER_CHILDREN_WRAPPER_CLASSNAME,
  MOBILE_DRAWER_CONTENT_CLASSNAME,
} from './mobileDrawerLayout';

describe('mobileDrawerLayout', () => {
  it('exports drawer content and children wrapper class strings', () => {
    expect(MOBILE_DRAWER_CONTENT_CLASSNAME).toContain('max-h-[80dvh]');
    expect(MOBILE_DRAWER_CHILDREN_WRAPPER_CLASSNAME).toContain('data-picker-scroll-body');
    expect(DESKTOP_PICKER_CHILDREN_WRAPPER_CLASSNAME).toContain('data-picker-scroll-body');
    expect(DESKTOP_PICKER_CHILDREN_WRAPPER_CLASSNAME).not.toContain('max-h-none');
  });
});
