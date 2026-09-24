export type { MkvmergeIdentificationOutput, TrackInfo, TrackProperties, ContainerInfo } from './types.js';

export { identifyFile } from './identify.js';

export { parseChaptersFromMkvinfo } from './chapters.js';
export type { ParsedChapter } from './chapters.js';

export { mkvmergeChapters, buildMkvmergeChaptersArgs } from './remux.js';

export { resolveTool } from './resolve-tool.js';
export type { ResolveToolOptions } from './resolve-tool.js';
