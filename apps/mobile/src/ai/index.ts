export type { AIService, QueryContext } from './types';
export { MockAIService } from './mock';

import { RemoteAIService } from './remote';
import type { AIService } from './types';

export const aiService: AIService = new RemoteAIService();
