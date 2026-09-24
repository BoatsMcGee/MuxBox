import {
    type Stream,
    type AVDisposition,
    Dictionary,
    AV_DISPOSITION_DEFAULT,
    AV_DISPOSITION_FORCED,
    AV_DISPOSITION_DUB,
    AV_DISPOSITION_ORIGINAL,
    AV_DISPOSITION_COMMENT,
    AV_DISPOSITION_LYRICS,
    AV_DISPOSITION_KARAOKE,
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
import {
    type VideoModify,
    type AudioModify,
    type SubtitleModify,
} from '../episode/types.js';

/**
 * All AV_DISPOSITION_* flags in a single array for iteration.
 */
const ALL_NATIVE_DISPOSITIONS: AVDisposition[] = [
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

/**
 * Apply a modify block to stream metadata and dispositions as a pure data transform.
 *
 * Returns the resulting metadata and dispositions without mutating any native objects.
 * Used by both the real `modifyStream()` (which then applies to native Stream/Dictionary)
 * and the simulator (which works entirely in data space).
 */
export function applyStreamModify(
    metadata: Record<string, string>,
    dispositions: number[],
    modify: { title?: string; language?: string; disposition?: Record<string, boolean>; tags?: Record<string, string | undefined> },
): { metadata: Record<string, string>; dispositions: number[] } {
    if (Object.keys(modify).length === 0) {
        return { metadata, dispositions };
    }

    const newMetadata = { ...metadata };

    if (modify.tags) {
        for (const [key, value] of Object.entries(modify.tags)) {
            if (value === undefined || value === '') {
                delete newMetadata[key];
            } else {
                newMetadata[key] = value;
            }
        }
    }
    if (modify.title !== undefined) {
        if (modify.title === '') {
            delete newMetadata['title'];
        } else {
            newMetadata['title'] = modify.title;
        }
    }
    if (modify.language !== undefined) {
        if (modify.language === '') {
            delete newMetadata['language'];
        } else {
            newMetadata['language'] = modify.language;
        }
    }

    // Apply dispositions
    let newDispositions = [...dispositions];
    if (modify.disposition) {
        for (const [key, enabled] of Object.entries(modify.disposition)) {
            const flag = Number(key);
            if (enabled === true && !newDispositions.includes(flag)) {
                newDispositions.push(flag);
            } else if (enabled === false) {
                newDispositions = newDispositions.filter(d => d !== flag);
            }
        }
    }

    return { metadata: newMetadata, dispositions: newDispositions };
}

export function modifyStream<TModify extends VideoModify | AudioModify | SubtitleModify>(stream: Stream, modify: TModify): Stream {
    const existingMetadata = stream.metadata?.getAll() ?? {};
    const existingDispositions: number[] = [];
    for (const d of ALL_NATIVE_DISPOSITIONS) {
        if (stream.hasDisposition(d)) existingDispositions.push(Number(d));
    }

    const { metadata: newMetadata, dispositions: newDispositions } = applyStreamModify(
        existingMetadata,
        existingDispositions,
        modify as { title?: string; language?: string; disposition?: Record<string, boolean>; tags?: Record<string, string | undefined> },
    );

    stream.metadata = Dictionary.fromObject(newMetadata);

    if (modify.disposition) {
        // Recompute the full set: clear all, set the ones we want
        const flagsToUnset: AVDisposition[] = [];
        const flagsToSet: AVDisposition[] = [];
        for (const d of ALL_NATIVE_DISPOSITIONS) {
            if (newDispositions.includes(Number(d))) {
                flagsToSet.push(d);
            } else {
                flagsToUnset.push(d);
            }
        }
        if (flagsToUnset.length > 0) {
            stream.clearDisposition(...flagsToUnset);
        }
        if (flagsToSet.length > 0) {
            stream.setDisposition(...flagsToSet);
        }
    }

    return stream;
}
