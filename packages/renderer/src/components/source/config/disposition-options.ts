import type { DispositionOption } from '@/components/source/types/stream-match-constants';

export const DISPOSITION_OPTIONS: DispositionOption[] = [
    { value: '1', label: 'Default' },
    { value: '2', label: 'Dub' },
    { value: '4', label: 'Original' },
    { value: '8', label: 'Comment' },
    { value: '16', label: 'Lyrics' },
    { value: '32', label: 'Karaoke' },
    { value: '64', label: 'Forced' },
    { value: '128', label: 'Hearing Impaired' },
    { value: '256', label: 'Visual Impaired' },
    { value: '512', label: 'Clean Effects' },
    { value: '1024', label: 'Attached Picture' },
    { value: '2048', label: 'Timed Thumbnails' },
    { value: '4096', label: 'Non-Diegetic' },
    { value: '65536', label: 'Captions' },
    { value: '131072', label: 'Descriptions' },
    { value: '262144', label: 'Metadata' },
    { value: '524288', label: 'Dependent' },
    { value: '1048576', label: 'Still Image' },
    { value: '2097152', label: 'Multilayer' },
];
