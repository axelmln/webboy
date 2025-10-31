const WRITE_POINTER_INDEX = 0;
const READ_POINTER_INDEX = 1;

class StereoProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.buffer = new Float32Array(options.processorOptions.sharedBuffer);
        this.bufferPointers = new Uint32Array(options.processorOptions.sharedBufferPointers);
    }

    process(_, outputList) {
        const [left, right] = outputList[0];

        for (let i = 0; i < left.length; i++) {
            const [leftSample, rightSample] = this.readSharedBuffer(i);
            left[i] = leftSample;
            right[i] = rightSample;
        }

        return true;
    }

    readSharedBuffer() {
        if (this.bufferPointers[READ_POINTER_INDEX] === this.bufferPointers[WRITE_POINTER_INDEX]) {
            return [-1, -1];
        }

        const [leftSamplePointer, rightSamplePointer] = this.consumeReadPointers();
        return [this.buffer[leftSamplePointer], this.buffer[rightSamplePointer]];
    }

    consumeReadPointers() {
        const leftSamplePointer = this.consumeReadPointer();
        const rightSamplePointers = this.consumeReadPointer();
        return [leftSamplePointer, rightSamplePointers];
    }

    consumeReadPointer() {
        const i = this.bufferPointers[1];
        this.bufferPointers[READ_POINTER_INDEX] = (this.bufferPointers[READ_POINTER_INDEX] + 1) % this.buffer.length;
        return i;
    }
}

registerProcessor("stereo-processor", StereoProcessor);
