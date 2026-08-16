import { describe, expect, it } from 'vitest';
import { resizeBoundsFromHandle } from './sketchSelectionUtils';
describe('resizeBoundsFromHandle', () => { const start={x:10,y:10,width:40,height:30}; it('expands se',()=>expect(resizeBoundsFromHandle('se',start,{x:60,y:50})).toMatchObject({x:10,y:10,width:50,height:40})); it('moves nw',()=>expect(resizeBoundsFromHandle('nw',start,{x:5,y:5})).toMatchObject({x:5,y:5})); });
