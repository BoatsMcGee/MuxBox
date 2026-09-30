/**
 * Regression test for native AVPacket lifetime on the mux success path.
 *
 * Bug: `muxer.ts` called `output.writePacketSync(packet, ...)` on the success
 * path and never called `packet.free()`. node-av does NOT take ownership — it
 * clones the packet and leaves the caller's intact — so one native AVPacket
 * leaked per written packet, with no FinalizationRegistry anywhere in node-av
 * to reclaim it.
 *
 * The merge loop is not extractable (it needs live Demuxer/Muxer natives), so
 * this asserts against the real source: the success path must free every packet
 * it writes, and must record progress BEFORE freeing (recordPacket reads
 * packet.dts/pts, so freeing first would be a use-after-free).
 *
 * A previous version of this test re-implemented the loop as a helper and passed
 * even with the bug reintroduced — it tested a copy, not the code. Reading the
 * actual source is what makes it a real regression guard.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const muxerSrc = readFileSync(
    path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../packages/muxer/src/episode/muxer.ts'),
    'utf-8',
);

/** Isolate the merge loop body: from `const entry = heap.pop()` to `tracker.setComplete()`. */
function mergeLoopBody(): string {
    const start = muxerSrc.indexOf('const entry = heap.pop()');
    expect(start, 'merge loop entry not found').toBeGreaterThan(-1);
    const end = muxerSrc.indexOf('tracker.setComplete();', start);
    expect(end, 'merge loop end not found').toBeGreaterThan(-1);
    return muxerSrc.slice(start, end);
}

describe('mux merge loop packet ownership', () => {
    const body = mergeLoopBody();

    it('frees every packet it writes to the output', () => {
        const writeIdx = body.indexOf('output.writePacketSync(packet, ctx.outputIndex)');
        expect(writeIdx, 'success-path writePacketSync not found').toBeGreaterThan(-1);

        // The write must be wrapped so the free runs even when it throws.
        const writeStatement = body.slice(writeIdx - 200, writeIdx + 200);
        expect(
            writeStatement,
            'success-path writePacketSync is not wrapped in try/finally — a throwing write would leak',
        ).toMatch(/try\s*\{[\s\S]*writePacketSync\(packet, ctx\.outputIndex\)[\s\S]*\}\s*finally\s*\{[\s\S]*packet\.free\(\)/);
    });

    it('frees the packet on the success path, not only on discard paths', () => {
        const writeIdx = body.indexOf('output.writePacketSync(packet, ctx.outputIndex)');
        const afterWrite = body.slice(writeIdx, writeIdx + 300);
        expect(
            afterWrite,
            'no packet.free() after the success-path writePacketSync — native AVPacket leaks',
        ).toContain('packet.free()');
    });

    it('records progress before freeing so dts/pts are not read after free', () => {
        const recordIdx = body.indexOf('tracker.recordPacket(writeKey, packet)');
        const writeIdx = body.indexOf('output.writePacketSync(packet, ctx.outputIndex)');
        const freeIdx = body.indexOf('packet.free()', writeIdx);
        expect(recordIdx, 'recordPacket not found').toBeGreaterThan(-1);
        expect(freeIdx, 'free() not found after the write').toBeGreaterThan(-1);
        // recordPacket reads packet.dts and packet.pts, so it must precede the free.
        expect(
            recordIdx,
            'recordPacket must run before packet.free() — recordPacket reads packet.dts/pts',
        ).toBeLessThan(writeIdx);
        expect(writeIdx).toBeLessThan(freeIdx);
    });
});
