use std::{
    io::{self},
    sync::mpsc::{channel, Receiver},
};
use wasm_bindgen::prelude::*;

use gamuboy::{
    config::Config,
    gameboy::GameBoy,
    joypad::{Button, Joypad},
    joypad_events_handler::{self},
    lcd::{FrameBuffer, LCD, PIXELS_HEIGHT, PIXELS_WIDTH},
    mode::Mode,
    saver::{self},
    stereo::StereoPlayer,
};

#[wasm_bindgen]
pub fn pixels_width() -> usize {
    PIXELS_WIDTH
}

#[wasm_bindgen]
pub fn pixels_height() -> usize {
    PIXELS_HEIGHT
}

#[wasm_bindgen]
pub struct WebBoy {
    gb: GameBoy<'static, WebLcd, WebJoypadEvent, WebJoypadEventHandler, WebStereo>,
}

#[wasm_bindgen]
impl WebBoy {
    #[wasm_bindgen(constructor)]
    pub fn new(
        rom: Vec<u8>,
        lcd: JsLcd,
        stereo: JsStereo,
        joypad_events_consumer: JsJoypadEventsConsumer,
        game_save: JsGameSave,
    ) -> Self {
        Self {
            gb: GameBoy::new(
                &Config {
                    mode: match rom[0x143] {
                        0x80 | 0xC0 => Mode::CGB,
                        _ => Mode::DMG,
                    },
                    rom,
                    headless_mode: false,
                    bootrom: None,
                    log_file_path: None,
                },
                WebLcd::new(lcd),
                WebStereo::new(stereo),
                WebJoypadEventHandler::new(joypad_events_consumer),
                WebGameSave::new(game_save),
                static_rx(),
            ),
        }
    }

    pub fn step_frame(&mut self) {
        self.gb.step_frame();
    }
}

fn static_rx<E>() -> &'static mut Receiver<E> {
    let (_, rx) = channel::<E>();
    Box::leak(Box::new(rx))
}

#[wasm_bindgen]
extern "C" {
    type JsLcd;

    #[wasm_bindgen(method)]
    fn draw_buffer(this: &JsLcd, framebuffer: Vec<u8>);
}

pub struct WebLcd {
    lcd: JsLcd,
}

impl WebLcd {
    pub fn new(lcd: JsLcd) -> Self {
        Self { lcd }
    }
}

impl LCD for WebLcd {
    fn draw_buffer(&mut self, framebuffer: &FrameBuffer) {
        self.lcd.draw_buffer(
            framebuffer
                .iter()
                .flatten()
                .map(|p| vec![p.0, p.1, p.2, 255])
                .flatten()
                .collect::<Vec<u8>>(),
        );
    }
}

#[wasm_bindgen]
extern "C" {
    type JsStereo;

    #[wasm_bindgen(method)]
    fn play(this: &JsStereo, samples: &[f32]);
}

pub struct WebStereo {
    stereo: JsStereo,
}

impl WebStereo {
    pub fn new(stereo: JsStereo) -> Self {
        Self { stereo }
    }
}

impl StereoPlayer for WebStereo {
    fn play(&self, samples: &[f32]) {
        self.stereo.play(samples);
    }
}

#[wasm_bindgen]
extern "C" {
    type JsJoypadEventsConsumer;

    #[wasm_bindgen(method)]
    fn consume_events(this: &JsJoypadEventsConsumer) -> Vec<WebJoypadEvent>;
}

pub struct WebJoypadEventHandler {
    consumer: JsJoypadEventsConsumer,
}

impl WebJoypadEventHandler {
    pub fn new(consumer: JsJoypadEventsConsumer) -> Self {
        Self { consumer }
    }
}

impl joypad_events_handler::EventsHandler<WebJoypadEvent> for WebJoypadEventHandler {
    fn handle_events(&mut self, _: &Receiver<WebJoypadEvent>, joypad: &mut Joypad) {
        for evt in self.consumer.consume_events().iter() {
            match evt.button {
                WebButton::A => joypad.update(Button::A, evt.pressed),
                WebButton::B => joypad.update(Button::B, evt.pressed),
                WebButton::Start => joypad.update(Button::Start, evt.pressed),
                WebButton::Select => joypad.update(Button::Select, evt.pressed),
                WebButton::Up => joypad.update(Button::Up, evt.pressed),
                WebButton::Down => joypad.update(Button::Down, evt.pressed),
                WebButton::Left => joypad.update(Button::Left, evt.pressed),
                WebButton::Right => joypad.update(Button::Right, evt.pressed),
            }
        }
    }
}

#[wasm_bindgen]
pub struct WebJoypadEvent {
    button: WebButton,
    pressed: bool,
}

#[wasm_bindgen]
impl WebJoypadEvent {
    #[wasm_bindgen(constructor)]
    pub fn new(button: WebButton, pressed: bool) -> Self {
        Self { button, pressed }
    }
}

#[wasm_bindgen]
pub enum WebButton {
    A,
    B,
    Start,
    Select,
    Up,
    Down,
    Left,
    Right,
}

#[wasm_bindgen]
extern "C" {
    type JsGameSave;

    #[wasm_bindgen(method)]
    fn save(this: &JsGameSave, ram: Vec<u8>);

    #[wasm_bindgen(method)]
    fn set_title(this: &JsGameSave, title: String);

    #[wasm_bindgen(method)]
    fn load(this: &JsGameSave) -> Vec<u8>;
}

pub struct WebGameSave {
    game_save: JsGameSave,
}

impl WebGameSave {
    pub fn new(game_save: JsGameSave) -> Self {
        Self { game_save }
    }
}

impl saver::GameSave for WebGameSave {
    fn set_title(&mut self, title: String) {
        self.game_save.set_title(title);
    }

    fn load(&self) -> Result<Vec<u8>, io::Error> {
        Ok(self.game_save.load())
    }

    fn save(&self, ram: &[u8]) -> Result<(), io::Error> {
        self.game_save.save(ram.to_vec());
        Ok(())
    }
}
