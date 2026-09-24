/**
 * Binary min-heap for streaming k-way merge of packets from multiple demuxers.
 * Maintains O(log k) push/pop where k = number of active demuxers.
 * Each demuxer's packets() iterator yields packets in DTS order, so we keep
 * one entry per demuxer in the heap and always pop the globally smallest DTS.
 * This eliminates O(n) memory accumulation and O(n log n) sort from the
 * previous collect-all-then-sort approach.
 */
export class MinHeap<T> {
    private heap: T[] = [];
    private readonly compare: (a: T, b: T) => number;

    constructor(compare: (a: T, b: T) => number) {
        this.compare = compare;
    }

    get size(): number {
        return this.heap.length;
    }

    push(value: T): void {
        this.heap.push(value);
        this.bubbleUp(this.heap.length - 1);
    }

    pop(): T | undefined {
        if (this.heap.length === 0) return undefined;
        if (this.heap.length === 1) return this.heap.pop();
        const top = this.heap[0];
        this.heap[0] = this.heap.pop()!;
        this.bubbleDown(0);
        return top;
    }

    private bubbleUp(index: number): void {
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (this.compare(this.heap[index], this.heap[parent]) >= 0) break;
            [this.heap[index], this.heap[parent]] = [this.heap[parent], this.heap[index]];
            index = parent;
        }
    }

    private bubbleDown(index: number): void {
        const size = this.heap.length;
        while (true) {
            let smallest = index;
            const left = (index << 1) + 1;
            const right = left + 1;
            if (left < size && this.compare(this.heap[left], this.heap[smallest]) < 0) smallest = left;
            if (right < size && this.compare(this.heap[right], this.heap[smallest]) < 0) smallest = right;
            if (smallest === index) break;
            [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
            index = smallest;
        }
    }
}
