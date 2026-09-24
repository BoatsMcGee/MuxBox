export { MinHeap } from './min-heap.js';
export {
    type WriteContext,
    type HeapEntry,
    buildWriteKey,
    getStreamKey,
    computeSortDtsUs,
    SyncPacketBucket,
    DemuxPacketReader,
} from './merge-streams.js';
export {
    TemplateField,
    type TemplateTags,
    DEFAULT_FILENAME_TEMPLATE,
    templateFileName,
} from './filename-template.js';

/**
 * Safely attempt to parse a RegExp from a string. Returns `null` on invalid syntax.
 */
export function tryParseRegex(pattern: string, flags?: string): RegExp | null {
    try {
        return new RegExp(pattern, flags);
    } catch {
        return null;
    }
}
