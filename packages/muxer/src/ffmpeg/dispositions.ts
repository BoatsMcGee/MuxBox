import {
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
    type AVDisposition,
} from 'node-av/constants';

export const All_DISPOSITIONS = [
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

export type DispositionState = Partial<Record<AVDisposition, boolean>>;

export function getDispositionName(disposition: AVDisposition): string {
    switch (disposition) {
        case AV_DISPOSITION_DEFAULT: return 'Default';
        case AV_DISPOSITION_DUB: return 'Dub';
        case AV_DISPOSITION_ORIGINAL: return 'Original';
        case AV_DISPOSITION_COMMENT: return 'Comment';
        case AV_DISPOSITION_LYRICS: return 'Lyrics';
        case AV_DISPOSITION_KARAOKE: return 'Karaoke';
        case AV_DISPOSITION_FORCED: return 'Forced';
        case AV_DISPOSITION_HEARING_IMPAIRED: return 'Hearing Impaired';
        case AV_DISPOSITION_VISUAL_IMPAIRED: return 'Visual Impaired';
        case AV_DISPOSITION_CLEAN_EFFECTS: return 'Clean Effects';
        case AV_DISPOSITION_ATTACHED_PIC: return 'Attached Picture';
        case AV_DISPOSITION_TIMED_THUMBNAILS: return 'Timed Thumbnails';
        case AV_DISPOSITION_NON_DIEGETIC: return 'Non-Diegetic';
        case AV_DISPOSITION_CAPTIONS: return 'Captions';
        case AV_DISPOSITION_DESCRIPTIONS: return 'Descriptions';
        case AV_DISPOSITION_METADATA: return 'Metadata';
        case AV_DISPOSITION_DEPENDENT: return 'Dependent';
        case AV_DISPOSITION_STILL_IMAGE: return 'Still Image';
        case AV_DISPOSITION_MULTILAYER: return 'Multilayer';
        default: throw new Error(`Unknown disposition: ${disposition}`);
    }
}

export function getDispositionFFmpegName(disposition: AVDisposition): string {
    switch (disposition) {
        case AV_DISPOSITION_DEFAULT: return 'default';
        case AV_DISPOSITION_DUB: return 'dub';
        case AV_DISPOSITION_ORIGINAL: return 'original';
        case AV_DISPOSITION_COMMENT: return 'comment';
        case AV_DISPOSITION_LYRICS: return 'lyrics';
        case AV_DISPOSITION_KARAOKE: return 'karaoke';
        case AV_DISPOSITION_FORCED: return 'forced';
        case AV_DISPOSITION_HEARING_IMPAIRED: return 'hearing_impaired';
        case AV_DISPOSITION_VISUAL_IMPAIRED: return 'visual_impaired';
        case AV_DISPOSITION_CLEAN_EFFECTS: return 'clean_effects';
        case AV_DISPOSITION_ATTACHED_PIC: return 'attached_pic';
        case AV_DISPOSITION_TIMED_THUMBNAILS: return 'timed_thumbnails';
        case AV_DISPOSITION_NON_DIEGETIC: return 'non_diegetic';
        case AV_DISPOSITION_CAPTIONS: return 'captions';
        case AV_DISPOSITION_DESCRIPTIONS: return 'descriptions';
        case AV_DISPOSITION_METADATA: return 'metadata';
        case AV_DISPOSITION_DEPENDENT: return 'dependent';
        case AV_DISPOSITION_STILL_IMAGE: return 'still_image';
        case AV_DISPOSITION_MULTILAYER: return 'multilayer';
        default: throw new Error(`Unknown disposition: ${disposition}`);
    }
}
