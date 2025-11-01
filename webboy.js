import init, { WebBoy, pixels_width, pixels_height, WebJoypadEvent, WebButton } from './pkg/webboy.js';

class JsLcd {
    /**
     * 
     * @param {HTMLElement} canvas 
     */
    constructor(canvas) {
        this.pixelsWidth = pixels_width();
        this.pixelsHeight = pixels_height();

        this.canvas = canvas;
        this.canvasCtx = this.canvas.getContext("2d");
        this.imageData = this.canvasCtx.createImageData(this.pixelsWidth, this.pixelsWidth);

        this.minScale = 1;
        this.maxScale = 7;

        this.scale = 3;
        this.scaleCanvas();

        this.lastFrameTime = Date.now();
    }

    scaleUp() {
        if (this.scale == this.maxScale) return;
        this.scale++;
        this.scaleCanvas();
    }

    scaleDown() {
        if (this.scale == this.minScale) return;
        this.scale--;
        this.scaleCanvas();
    }

    scaleCanvas() {
        this.scaledWidth = this.pixelsWidth * this.scale;
        this.scaledHeight = this.pixelsHeight * this.scale;

        this.canvas.width = this.scaledWidth;
        this.canvas.height = this.scaledHeight;
    }

    draw_buffer(framebuffer) {
        this.imageData.data.set(framebuffer);
        this.canvasCtx.putImageData(this.imageData, 0, 0);
        this.canvasCtx.drawImage(this.canvas, 0, 0, this.pixelsWidth, this.pixelsHeight, 0, 0, this.scaledWidth, this.scaledHeight);
    }

    computeFrameCapping() {
        const frameDuration = 1000 / 60;
        const sincePrevious = Date.now() - this.lastFrameTime;
        return Math.max(frameDuration - sincePrevious, 0);
    }

    updateFrameTime() {
        this.lastFrameTime = Date.now();
    }
}

const AUDIO_SAMPLE_RATE = 48_000;
const SHARED_AUDIO_BUFFER_WRITE_POINTER_INDEX = 0;

class JsStereo {
    /**
     * 
     * @param {AudioContext} audioCtx 
     */
    static async new(audioCtx) {
        const sharedBuffer = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * AUDIO_SAMPLE_RATE * 2);
        const sharedBufferPointers = new SharedArrayBuffer(Uint32Array.BYTES_PER_ELEMENT * 2);

        await audioCtx.audioWorklet.addModule('audioworklet.js?' + Date.now());

        const node = new AudioWorkletNode(audioCtx, 'stereo-processor', {
            outputChannelCount: [2],
            processorOptions: {
                sharedBuffer,
                sharedBufferPointers,
            }
        });

        node.connect(audioCtx.destination);

        document.addEventListener('click', async () => {
            if (audioCtx.state === 'suspended') {
                await audioCtx.resume();
            }
        });

        const stereo = new JsStereo(audioCtx, new Float32Array(sharedBuffer), new Uint32Array(sharedBufferPointers));
        stereo.registerAudioContextResumer();

        return stereo;
    }

    constructor(audioCtx, buffer, bufferPointers) {
        this.audioCtx = audioCtx;
        this.buffer = buffer;
        this.bufferPointers = bufferPointers;
    }

    play(samples) {
        for (const sample of samples) {
            this.writeSharedBuffer(sample);
        }
    }

    writeSharedBuffer(sample) {
        this.buffer[this.bufferPointers[SHARED_AUDIO_BUFFER_WRITE_POINTER_INDEX]] = sample;
        this.bufferPointers[SHARED_AUDIO_BUFFER_WRITE_POINTER_INDEX] = (this.bufferPointers[SHARED_AUDIO_BUFFER_WRITE_POINTER_INDEX] + 1) % this.buffer.length;
    }

    registerAudioContextResumer() {
        document.addEventListener('click', async () => {
            if (this.audioCtx.state === 'suspended') {
                await audioCtx.resume();
            }
        });
    }
}

class JsJoypadEventsConsumer {
    /**
     * 
     * @param {WebJoypadEvent[]} events 
     */
    constructor(events) {
        this.events = events;
    }

    consume_events() {
        return this.events.splice(0);
    }
}

class JsGameSave {
    constructor() { }

    set_title(title) {
        this.title = title;
    }

    load() {
        const saved = localStorage.getItem(this.title);
        if (!saved) return [];
        return Uint8Array.fromBase64(saved);
    }

    /**
     * 
     * @param {Uint8Array} ram 
     */
    save(ram) {
        localStorage.setItem(this.title, ram.toBase64());
    }
}

/**
 * 
 * @param {Uint8Array} rom 
 */
async function runWebboy(rom) {
    await init();

    const lcd = new JsLcd(document.getElementById("webboy"))
    registerLcdScaler(lcd);

    const joypadEvents = [];
    registerJoypadEventsProducer(joypadEvents);

    const webBoy = new WebBoy(
        rom,
        lcd,
        await JsStereo.new(new AudioContext({
            sampleRate: AUDIO_SAMPLE_RATE,
            latencyHint: 'playback',
        })),
        new JsJoypadEventsConsumer(joypadEvents),
        new JsGameSave(),
    );

    function frame() {
        lcd.updateFrameTime();

        handleGamepadState(joypadEvents);

        webBoy.step_frame();
        setTimeout(() => requestAnimationFrame(frame), lcd.computeFrameCapping());
    }

    requestAnimationFrame(frame);
}

/**
 * 
 * @param {JsLcd} lcd 
 */
function registerLcdScaler(lcd) {
    document.getElementById("scale_up").addEventListener("click", () => lcd.scaleUp());
    document.addEventListener("keyup", function (evt) {
        if (evt.key == "+") lcd.scaleUp();
    });

    document.getElementById("scale_down").addEventListener("click", () => lcd.scaleDown());
    document.addEventListener("keyup", function (evt) {
        if (evt.key == "-") lcd.scaleDown();
    });
}

const GAMEPAD_BUTTON_A = 0;
const GAMEPAD_BUTTON_B = 1;
const GAMEPAD_BUTTON_SELECT = 8;
const GAMEPAD_BUTTON_START = 9;
const GAMEPAD_BUTTON_CROSS_UP = 12;
const GAMEPAD_BUTTON_CROSS_DOWN = 13;
const GAMEPAD_BUTTON_CROSS_LEFT = 14;
const GAMEPAD_BUTTON_CROSS_RIGHT = 15;
const GAMEPAD_JOYSTICK_HORIZONTAL_AXE = 0;
const GAMEPAD_JOYSTICK_VERTICAL_AXE = 1;
const GAMEPAD_JOYSTICK_DEAD_ZONE = 0.5;

/**
 * 
 * @param {WebJoypadEvent[]} joypadEvents 
 */
function handleGamepadState(joypadEvents) {
    const gamepad = navigator.getGamepads()[0];
    if (!gamepad) return;

    joypadEvents.push(
        new WebJoypadEvent(WebButton.Start, gamepad.buttons[GAMEPAD_BUTTON_START].pressed),
    );
    joypadEvents.push(
        new WebJoypadEvent(WebButton.SelectStart, gamepad.buttons[GAMEPAD_BUTTON_SELECT].pressed),
    );
    joypadEvents.push(
        new WebJoypadEvent(WebButton.A, gamepad.buttons[GAMEPAD_BUTTON_A].pressed),
    );
    joypadEvents.push(
        new WebJoypadEvent(WebButton.B, gamepad.buttons[GAMEPAD_BUTTON_B].pressed),
    );

    joypadEvents.push(
        new WebJoypadEvent(WebButton.Up, gamepad.buttons[GAMEPAD_BUTTON_CROSS_UP].pressed || gamepad.axes[GAMEPAD_JOYSTICK_VERTICAL_AXE] < -GAMEPAD_JOYSTICK_DEAD_ZONE),
    );
    joypadEvents.push(
        new WebJoypadEvent(WebButton.Down, gamepad.buttons[GAMEPAD_BUTTON_CROSS_DOWN].pressed || gamepad.axes[GAMEPAD_JOYSTICK_VERTICAL_AXE] > GAMEPAD_JOYSTICK_DEAD_ZONE),
    );
    joypadEvents.push(
        new WebJoypadEvent(WebButton.Left, gamepad.buttons[GAMEPAD_BUTTON_CROSS_LEFT].pressed || gamepad.axes[GAMEPAD_JOYSTICK_HORIZONTAL_AXE] < -GAMEPAD_JOYSTICK_DEAD_ZONE),
    );
    joypadEvents.push(
        new WebJoypadEvent(WebButton.Right, gamepad.buttons[GAMEPAD_BUTTON_CROSS_RIGHT].pressed || gamepad.axes[GAMEPAD_JOYSTICK_HORIZONTAL_AXE] > GAMEPAD_JOYSTICK_DEAD_ZONE),
    );
}

function registerJoypadEventsProducer(joypadEvents) {
    document.addEventListener("keydown", function (evt) {
        handleKeyEvent(joypadEvents, evt.key, true);
    });
    document.addEventListener("keyup", function (evt) {
        handleKeyEvent(joypadEvents, evt.key, false);
    });
}

function handleKeyEvent(joypadEvents, key, pressed) {
    const button = mapButton(key);
    if (button === undefined) return;
    joypadEvents.push(new WebJoypadEvent(button, pressed));
}

function mapButton(key) {
    return {
        "a": WebButton.A,
        "z": WebButton.B,
        "Enter": WebButton.Start,
        "s": WebButton.Select,
        "ArrowUp": WebButton.Up,
        "ArrowDown": WebButton.Down,
        "ArrowLeft": WebButton.Left,
        "ArrowRight": WebButton.Right,
    }[key];
}

const dropZone = document.getElementById("webboy_div");

async function romPickerHandler() {
    /**
     * @type {FileSystemFileHandle[]}
     */
    const filesHandles = await showOpenFilePicker();
    if (filesHandles.length !== 1) return;

    romReceivedCleanUp();

    const filesHandle = filesHandles[0];

    const file = await filesHandle.getFile();

    const rom = new Uint8Array(await file.arrayBuffer());
    runWebboy(rom);
};

dropZone.addEventListener('click', romPickerHandler);

function preventDefaults(evt) {
    evt.preventDefault();
    evt.stopPropagation();
}

dropZone.addEventListener('dragenter', preventDefaults);
dropZone.addEventListener('dragover', evt => {
    preventDefaults(evt);
    dropZone.style.border = "3px dashed darkgrey";
    dropZone.style.width = `${160 * 3 + 25}px`;
    dropZone.style.height = `${144 * 3 + 25}px`;
});
dropZone.addEventListener('dragleave', evt => {
    preventDefaults(evt);
    dropZone.style.border = "2px dashed lightgrey";
    dropZone.style.width = "calc(160px*3)";
    dropZone.style.height = "calc(144px*3)";
});

function romDropHandler(evt) {
    evt.preventDefault();

    if (evt.dataTransfer.files.length !== 1) return;

    romReceivedCleanUp();

    const file = evt.dataTransfer.files[0];

    const reader = new FileReader();
    reader.readAsArrayBuffer(file);

    reader.onloadend = function (e) {
        const rom = new Uint8Array(e.target.result);
        runWebboy(rom);
    };
}

dropZone.addEventListener("drop", romDropHandler);

function romReceivedCleanUp() {
    document.getElementById("drop_here").setAttribute("hidden", "true");
    dropZone.style.border = "none";
    dropZone.style.cursor = "auto";
    dropZone.removeEventListener("click", romPickerHandler);
    dropZone.removeEventListener("drop", romDropHandler);
}

const controlButton = document.getElementById("control_button");
const modal = document.getElementById("mapping_modal");
const closeModal = document.getElementById("close_modal");

controlButton.addEventListener("click", () => {
    modal.classList.add("show");
});

closeModal.addEventListener("click", () => {
    modal.classList.remove("show");
});

modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("show");
});