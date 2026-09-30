import {describe, it, expect} from 'vitest';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {repositoryFromBottleUrl, tarExecutable} from '../../../scripts/fetch-external-tools.mjs';

describe('repositoryFromBottleUrl', () => {
    it('maps a versioned formula bottle url to its slash-separated repository', () => {
        expect(repositoryFromBottleUrl(
            'https://ghcr.io/v2/homebrew/core/icu4c/78/blobs/sha256:237dc113cc2df7c3b0c327ae96d567c71a86bc6d89c402860603e7b233933c05',
        )).toBe('homebrew/core/icu4c/78');
    });

    it('keeps plain formula repositories unchanged', () => {
        expect(repositoryFromBottleUrl(
            'https://ghcr.io/v2/homebrew/core/mkvtoolnix/blobs/sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        )).toBe('homebrew/core/mkvtoolnix');
    });

    it('returns null for unrecognized urls so callers fall back to the formula name', () => {
        expect(repositoryFromBottleUrl('https://example.com/some/file.tar.gz')).toBeNull();
        expect(repositoryFromBottleUrl('not a url')).toBeNull();
    });
});

describe('tarExecutable', () => {
    it('resolves the executable for the current platform', () => {
        const tar = tarExecutable();
        if (process.platform === 'win32') {
            expect(path.basename(tar)).toBe('tar.exe');
            expect(existsSync(tar)).toBe(true);
        } else {
            expect(tar).toBe('tar');
        }
    });
});
