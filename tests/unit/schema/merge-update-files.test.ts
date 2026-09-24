import {describe, it, expect} from 'vitest';
import {
    mergeChannelText,
    parseYamlFilesBlock,
} from '../../../scripts/merge-update-files.mjs';

/** Channel file as electron-builder emits it (flat YAML, quoted date, per-file size). */
function channelYml(arch: string, version = '0.0.1'): string {
    return [
        `version: ${version}`,
        'files:',
        `  - url: MuxBox-${version}-win-${arch}.exe`,
        `    sha512: SHA-${arch}+/=`,
        `    size: 123456`,
        `path: MuxBox-${version}-win-${arch}.exe`,
        `sha512: SHA-${arch}+/=`,
        `releaseDate: '2026-09-23 12:00:00'`,
        '',
    ].join('\n');
}

describe('parseYamlFilesBlock', () => {
    it('parses the files block and leaves surrounding keys alone', () => {
        const parsed = parseYamlFilesBlock(channelYml('x64'));

        expect(parsed.files).toEqual([
            {url: 'MuxBox-0.0.1-win-x64.exe', sha512: 'SHA-x64+/=', size: '123456'},
        ]);
        expect(parsed.lines[0]).toBe('version: 0.0.1');
    });

    it('unquotes single-quoted scalars', () => {
        const text = channelYml('x64').replace(
            '  - url: MuxBox-0.0.1-win-x64.exe',
            "  - url: 'MuxBox 0.0.1 win x64.exe'",
        );

        expect(parseYamlFilesBlock(text).files[0].url).toBe('MuxBox 0.0.1 win x64.exe');
    });

    it('rejects files entries without sha512', () => {
        const broken = channelYml('x64').replace('    sha512: SHA-x64+/=', '');

        expect(() => parseYamlFilesBlock(broken)).toThrow(/url\/sha512/);
    });

    it('rejects documents without a files block', () => {
        expect(() => parseYamlFilesBlock('version: 1.0.0\n')).toThrow(/files:/);
    });
});

describe('mergeChannelText', () => {
    it('unions both architectures into one channel file', () => {
        const merged = mergeChannelText(channelYml('x64'), [channelYml('arm64')]);
        const {files} = parseYamlFilesBlock(merged);

        expect(files.map((file) => file.url)).toEqual([
            'MuxBox-0.0.1-win-x64.exe',
            'MuxBox-0.0.1-win-arm64.exe',
        ]);
        // Base (first) job still owns the legacy top-level fields.
        expect(merged).toContain('path: MuxBox-0.0.1-win-x64.exe');
        expect(merged).toContain(`releaseDate: '2026-09-23 12:00:00'`);
        expect(merged).toContain('version: 0.0.1');
    });

    it('deduplicates identical entries', () => {
        const merged = mergeChannelText(channelYml('x64'), [channelYml('x64')]);
        const {files} = parseYamlFilesBlock(merged);

        expect(files).toHaveLength(1);
    });

    it('fails loudly on version mismatches across jobs', () => {
        expect(() => mergeChannelText(channelYml('x64'), [channelYml('arm64', '0.0.2')]))
            .toThrow(/version mismatch/);
    });

    it('keeps entries following the files block intact', () => {
        const text = channelYml('x64').replace(
            "releaseDate: '2026-09-23 12:00:00'",
            "releaseDate: '2026-09-23 12:00:00'\nextraKey: keep-me",
        );
        const merged = mergeChannelText(text, [channelYml('arm64')]);

        expect(merged).toContain('extraKey: keep-me');
        expect(parseYamlFilesBlock(merged).files).toHaveLength(2);
    });
});
