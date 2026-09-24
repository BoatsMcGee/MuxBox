import {
    type Stream,
    AV_DICT_MATCH_CASE,
    type AVDisposition,
    AV_DISPOSITION_DEFAULT,
    AV_DISPOSITION_DUB,
    AV_DISPOSITION_ORIGINAL,
    AV_DISPOSITION_COMMENT,
    AV_DISPOSITION_LYRICS,
    AV_DISPOSITION_KARAOKE,
    AV_DISPOSITION_FORCED,
    AV_DISPOSITION_HEARING_IMPAIRED,
    AV_DISPOSITION_VISUAL_IMPAIRED,
    AV_DISPOSITION_CLEAN_EFFECTS,
    AV_DISPOSITION_ATTACHED_PIC,
    AV_DISPOSITION_TIMED_THUMBNAILS,
    AV_DISPOSITION_NON_DIEGETIC,
    AV_DISPOSITION_CAPTIONS,
    AV_DISPOSITION_DESCRIPTIONS,
    AV_DISPOSITION_METADATA,
    AV_DISPOSITION_DEPENDENT,
    AV_DISPOSITION_STILL_IMAGE,
    AV_DISPOSITION_MULTILAYER,
} from 'node-av';
import { type ProcessedStream } from '../selector/index.js';

export const ALL_DISPOSITIONS = [
    AV_DISPOSITION_DEFAULT,
    AV_DISPOSITION_DUB,
    AV_DISPOSITION_ORIGINAL,
    AV_DISPOSITION_COMMENT,
    AV_DISPOSITION_LYRICS,
    AV_DISPOSITION_KARAOKE,
    AV_DISPOSITION_FORCED,
    AV_DISPOSITION_HEARING_IMPAIRED,
    AV_DISPOSITION_VISUAL_IMPAIRED,
    AV_DISPOSITION_CLEAN_EFFECTS,
    AV_DISPOSITION_ATTACHED_PIC,
    AV_DISPOSITION_TIMED_THUMBNAILS,
    AV_DISPOSITION_NON_DIEGETIC,
    AV_DISPOSITION_CAPTIONS,
    AV_DISPOSITION_DESCRIPTIONS,
    AV_DISPOSITION_METADATA,
    AV_DISPOSITION_DEPENDENT,
    AV_DISPOSITION_STILL_IMAGE,
    AV_DISPOSITION_MULTILAYER,
];

export function listDispositions(stream: Stream): AVDisposition[] {
    const dispositions: AVDisposition[] = [];

    for (const disposition of ALL_DISPOSITIONS) {
        if (stream.hasDisposition(disposition)) {
            dispositions.push(disposition);
        }
    }

    return dispositions;
}

/**
 * Sorts streams by disposition and language. Streams with the Original disposition are grouped at the start.
 * @param streams - Processed streams to sort
 */
const DispositionSortPriority = {
    FORCED: 0,
    DEFAULT: 1,
    NONE: 2,
    DUB: 3,
    HEARING_IMPAIRED: 4,
    VISUAL_IMPAIRED: 5,
    CAPTIONS: 6,
    COMMENT: 7,
    REST: 8,
} as const;
type DispositionSortPriority = (typeof DispositionSortPriority)[keyof typeof DispositionSortPriority];

export function sortStreams(streams: (ProcessedStream & { filePath: string; })[]): void {
    
    function getDispositionSortPriority(stream: Stream): DispositionSortPriority {
        const relevantDispositions = listDispositions(stream).filter(disposition => disposition !== AV_DISPOSITION_ORIGINAL);

        // Streams with no other dispositions (except possibly ORIGINAL) go here
        if (relevantDispositions.length === 0) return DispositionSortPriority.NONE;
    
        // Check in order of priority
        if (relevantDispositions.includes(AV_DISPOSITION_FORCED)) return DispositionSortPriority.FORCED;
        if (relevantDispositions.includes(AV_DISPOSITION_DEFAULT)) return DispositionSortPriority.DEFAULT;
        if (relevantDispositions.length === 0) return DispositionSortPriority.NONE;
        if (relevantDispositions.includes(AV_DISPOSITION_DUB)) return DispositionSortPriority.DUB;
        if (relevantDispositions.includes(AV_DISPOSITION_HEARING_IMPAIRED)) return DispositionSortPriority.HEARING_IMPAIRED;
        if (relevantDispositions.includes(AV_DISPOSITION_VISUAL_IMPAIRED)) return DispositionSortPriority.VISUAL_IMPAIRED;
        if (relevantDispositions.includes(AV_DISPOSITION_CAPTIONS)) return DispositionSortPriority.CAPTIONS;
        if (relevantDispositions.includes(AV_DISPOSITION_COMMENT)) return DispositionSortPriority.COMMENT;
    
        // Unknown/Unhandled dispositions
        return DispositionSortPriority.REST;
    }

    streams.sort((a, b) => {
        const streamA = a.stream;
        const streamB = b.stream;

        const hasOriginalA = streamA.hasDisposition(AV_DISPOSITION_ORIGINAL);
        const hasOriginalB = streamB.hasDisposition(AV_DISPOSITION_ORIGINAL);
    
        // ORIGINAL streams come first
        if (hasOriginalA && !hasOriginalB) return -1;
        if (!hasOriginalA && hasOriginalB) return 1;
    
        if (hasOriginalA && hasOriginalB) {
            // Both are ORIGINAL, sort by disposition hierarchy
            const priorityA = getDispositionSortPriority(streamA);
            const priorityB = getDispositionSortPriority(streamB);
            return priorityA - priorityB;
        }
    
        // Neither is ORIGINAL, sort by language
        const langA = streamA.metadata?.get('language', AV_DICT_MATCH_CASE) || '';
        const langB = streamB.metadata?.get('language', AV_DICT_MATCH_CASE) || '';
    
        if (langA < langB) return -1;
        if (langA > langB) return 1;
    
        // Same language, sort by disposition hierarchy
        const priorityA = getDispositionSortPriority(streamA);
        const priorityB = getDispositionSortPriority(streamB);
        return priorityA - priorityB;
    });

}

// For sorting by friendly language name
// import { parse } from 'bcp-47';
// import langs from 'langs';

// const tags = ['en-US', 'fra', 'de'];

// const languageNames = tags.map(tag => {
//     // 1. Extract the base language code (handles BCP 47 and simple ISO)
//     const baseCode = parse(tag).language || tag; 
    
//     // 2. Find the language object across ISO 639-1/2/3
//     const match = langs.where("1", baseCode) || langs.where("2", baseCode) || langs.where("3", baseCode);
    
//     return match ? match.name : "Unknown";
// });