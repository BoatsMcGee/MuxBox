// ─── Types for mkvmerge -J identification output ──────────────
//
// Based on mkvmerge-identification-output-schema-v20.json.
// All properties are optional since real output varies per file type
// and mkvmerge version — the schema defines only known properties.

/** Top-level mkvmerge identification output. */
export interface MkvmergeIdentificationOutput {
    /** The identified file's name. */
    file_name?: string;
    /** Version of the output format (20 for v20). */
    identification_format_version?: number;
    /** Information about the identified container. */
    container?: ContainerInfo;
    /** Array of tracks found in the file. */
    tracks?: TrackInfo[];
    /** Array of attachments found. */
    attachments?: AttachmentInfo[];
    /** Array of chapter entries. */
    chapters?: ChapterInfo[];
    /** Array of global tags. */
    global_tags?: GlobalTagInfo[];
    /** Array of per-track tags. */
    track_tags?: TrackTagInfo[];
    /** Error messages. */
    errors?: string[];
    /** Warning messages. */
    warnings?: string[];
}

// ─── Container ─────────────────────────────────────────────────

export interface ContainerInfo {
    /** Whether mkvmerge recognises the container format. */
    recognized?: boolean;
    /** Whether mkvmerge can read the container format. */
    supported?: boolean;
    /** Human-readable name for the container format. */
    type?: string;
    /** Additional properties varying by container format. */
    properties?: ContainerProperties;
}

export interface ContainerProperties {
    /** Unique number identifying the container type. */
    container_type?: number;
    /** Muxing date in ISO 8601 (local time). */
    date_local?: string;
    /** Muxing date in ISO 8601 (UTC). */
    date_utc?: string;
    /** File/segment duration in nanoseconds. */
    duration?: number;
    /** Whether the container provides timestamps. */
    is_providing_timestamps?: boolean;
    /** Low-level library that created the file. */
    muxing_application?: string;
    /** High-level application that created the file. */
    writing_application?: string;
    /** Next segment UID (hex, 32 chars, Matroska). */
    next_segment_uid?: string;
    /** Previous segment UID (hex, 32 chars, Matroska). */
    previous_segment_uid?: string;
    /** Segment UID (hex, 32 chars, Matroska). */
    segment_uid?: string;
    /** Timestamp scale in nanoseconds. */
    timestamp_scale?: number;
    /** Container title. */
    title?: string;
    /** Whether the file is a playlist. */
    playlist?: boolean;
    /** Number of chapters in a playlist. */
    playlist_chapters?: number;
    /** Total playlist duration in nanoseconds. */
    playlist_duration?: number;
    /** Total playlist size in bytes. */
    playlist_size?: number;
    /** Additional files referenced by a playlist. */
    playlist_file?: string[];
    /** Other files processed as well. */
    other_file?: string[];
    /** Programs multiplexed into the source (e.g. DVB). */
    programs?: ProgramInfo[];
}

export interface ProgramInfo {
    /** Unique number identifying a set of tracks. */
    program_number?: number;
    /** Service name (e.g. TV channel name). */
    service_name?: string;
    /** Service provider name. */
    service_provider?: string;
}

// ─── Tracks ────────────────────────────────────────────────────

export interface TrackInfo {
    /** Track codec (human-readable). */
    codec?: string;
    /** Track ID (unique within the file). */
    id?: number;
    /** Track type: "video", "audio", "subtitles", "buttons". */
    type?: string;
    /** Track properties varying by codec/type. */
    properties?: TrackProperties;
}

export interface TrackProperties {
    /** Track codec ID (e.g. "V_MPEG4/ISO/AVC"). */
    codec_id?: string;
    /** Track codec name. */
    codec_name?: string;
    /** Track language (ISO 639-2, e.g. "eng", "jpn", "und"). */
    language?: string;
    /** Track language (IETF BCP 47, e.g. "en", "ja", "en-US"). */
    language_ietf?: string;
    /** Track name. */
    track_name?: string;

    /** Default track flag. */
    default_track?: boolean;
    /** Forced track flag. */
    forced_track?: boolean;
    /** Enabled track flag. */
    enabled_track?: boolean;

    /** Default duration per frame in nanoseconds. */
    default_duration?: number;
    /** Minimum timestamp in nanoseconds. */
    minimum_timestamp?: number;
    /** Number of index entries. */
    num_index_entries?: number;

    /** Track number (1-based in Matroska). */
    number?: number;
    /** Unique track ID (Matroska). */
    uid?: number;
    /** Packetizer used. */
    packetizer?: string;

    // Video
    /** Pixel dimensions as "WxH". */
    pixel_dimensions?: string;
    /** Display dimensions as "WxH". */
    display_dimensions?: string;
    /** Display unit. */
    display_unit?: number;
    /** Pixel aspect ratio. */
    pixel_cropping?: string;

    // Audio
    /** Number of audio channels. */
    audio_channels?: number;
    /** Audio sampling frequency. */
    audio_sampling_frequency?: number;
    /** Bits per sample. */
    audio_bits_per_sample?: number;

    // Subtitles
    /** Whether the track contains text subtitles. */
    text_subtitles?: boolean;
    /** Character encoding for text tracks. */
    encoding?: string;

    // Video colour
    /** Color primaries. */
    color_primaries?: number;
    /** Color transfer characteristics. */
    color_transfer_characteristics?: number;
    /** Color matrix coefficients. */
    color_matrix_coefficients?: number;
    /** Color bits per channel. */
    color_bits_per_channel?: number;
    /** Color range. */
    color_range?: number;
    /** Chroma subsampling as "W,H". */
    chroma_subsample?: string;
    /** Chroma siting as "W,H". */
    chroma_siting?: string;

    // HDR
    /** Max content light level. */
    max_content_light?: number;
    /** Max frame light level. */
    max_frame_light?: number;
    /** Max luminance. */
    max_luminance?: number;
    /** Min luminance. */
    min_luminance?: number;

    // Flags
    /** Flag for hearing impaired. */
    flag_hearing_impaired?: boolean;
    /** Flag for visual impaired. */
    flag_visual_impaired?: boolean;
    /** Flag for text descriptions. */
    flag_text_descriptions?: boolean;
    /** Flag for original language track. */
    flag_original?: boolean;
    /** Flag for commentary track. */
    flag_commentary?: boolean;

    // Stream identification
    /** Stream ID (format-specific). */
    stream_id?: number;
    /** Sub-stream ID (format-specific). */
    sub_stream_id?: number;
    /** Program number (MPEG-TS). */
    program_number?: number;
    /** Teletext page number. */
    teletext_page?: number;
    /** Multiplexed track IDs. */
    multiplexed_tracks?: number[];

    // Codec details
    /** Private codec data (hex string). */
    codec_private_data?: string;
    /** Private codec data length. */
    codec_private_length?: number;
    /** AAC SBR flag. */
    aac_is_sbr?: 'true' | 'false' | 'unknown';
    /** Audio emphasis. */
    audio_emphasis?: number;
    /** Codec delay in nanoseconds. */
    codec_delay?: number;

    // Cropping / projection
    /** Pixel cropping. */
    pixel_cropping_?: string;

    // Max fallback
    /** Stereo mode. */
    stereo_mode?: number;
    /** Alpha mode. */
    alpha_mode?: number;

    // mkvmerge tag_* statistics fields (pattern properties)
    /** BPS (bits per second). */
    tag_bps?: string;
    /** Duration of the track. */
    tag_duration?: string;
    /** Number of frames. */
    tag_number_of_frames?: string;
    /** Number of bytes. */
    tag_number_of_bytes?: string;
    /** Statistics tags present. */
    tag__statistics_tags?: string;
    /** Statistics writing app. */
    tag__statistics_writing_app?: string;
    /** Statistics writing date (UTC). */
    tag__statistics_writing_date_utc?: string;
}

// ─── Attachments ───────────────────────────────────────────────

export interface AttachmentInfo {
    /** Attachment file name. */
    file_name?: string;
    /** Attachment MIME content type. */
    content_type?: string;
    /** Attachment description. */
    description?: string;
    /** Attachment ID. */
    id?: number;
    /** Attachment size in bytes. */
    size?: number;
    /** Attachment properties. */
    properties?: AttachmentProperties;
    /** Attachment type. */
    type?: string;
}

export interface AttachmentProperties {
    /** Attachment unique ID. */
    uid?: number;
}

// ─── Chapters ──────────────────────────────────────────────────

export interface ChapterInfo {
    /** Number of chapter entries. */
    num_entries?: number;
}

// ─── Tags ──────────────────────────────────────────────────────

export interface GlobalTagInfo {
    /** Number of tag entries. */
    num_entries?: number;
}

export interface TrackTagInfo {
    /** Track ID these tags belong to. */
    track_id?: number;
    /** Number of tag entries. */
    num_entries?: number;
}
