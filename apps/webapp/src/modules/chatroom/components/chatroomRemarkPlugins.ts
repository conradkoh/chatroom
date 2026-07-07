import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import { remarkWorkspacePathLinkify } from './remarkWorkspacePathLinkify';

export const chatroomRemarkPlugins = [remarkGfm, remarkBreaks, remarkWorkspacePathLinkify];
