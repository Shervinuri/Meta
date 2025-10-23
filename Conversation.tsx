/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Copyright 2025 Google LLC

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at

//     https://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  Type,
  FunctionDeclaration,
} from '@google/genai';
import {useAtom} from 'jotai';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  BoundingBoxesAtom,
  ConnectionStateAtom,
  TranscriptsAtom,
} from './atoms';
import {BoundingBox2DType} from './Types';
import {blobToBase64, decode, decodeAudioData, encode} from './utils';

const FRAME_RATE = 2; // frames per second
const JPEG_QUALITY = 0.7;

const highlightObjectFunctionDeclaration: FunctionDeclaration = {
  name: 'highlight_object',
  parameters: {
    type: Type.OBJECT,
    description:
      'Highlights a specified object in the camera feed by drawing a bounding box around it.',
    properties: {
      label: {
        type: Type.STRING,
        description: 'A descriptive label for the object being highlighted.',
      },
      box_2d: {
        type: Type.ARRAY,
        description:
          'The bounding box coordinates [ymin, xmin, ymax, xmax] normalized to 0-1000.',
        items: {
          type: Type.NUMBER,
        },
      },
    },
    required: ['label', 'box_2d'],
  },
};

export function Conversation() {
  const [connectionState, setConnectionState] = useAtom(ConnectionStateAtom);
  const [transcripts, setTranscripts] = useAtom(TranscriptsAtom);
  const [boundingBoxes, setBoundingBoxes] = useAtom(BoundingBoxesAtom);
  const [isMuted, setIsMuted] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const boxTimeoutRef = useRef<number | null>(null);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop =
        transcriptContainerRef.current.scrollHeight;
    }
  }, [transcripts]);

  const stopAISession = useCallback(() => {
    sessionPromiseRef.current?.then((session) => session.close());
    sessionPromiseRef.current = null;

    if (
      inputAudioContextRef.current &&
      inputAudioContextRef.current.state !== 'closed'
    ) {
      inputAudioContextRef.current.close();
    }
    inputAudioContextRef.current = null;
    if (
      outputAudioContextRef.current &&
      outputAudioContextRef.current.state !== 'closed'
    ) {
      outputAudioContextRef.current.close();
    }
    outputAudioContextRef.current = null;

    scriptProcessorRef.current?.disconnect();
    scriptProcessorRef.current = null;
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    frameIntervalRef.current = null;
    if (boxTimeoutRef.current) clearTimeout(boxTimeoutRef.current);
    boxTimeoutRef.current = null;
    setConnectionState('idle');
    setBoundingBoxes([]);
  }, [setConnectionState, setBoundingBoxes]);

  const draw = useCallback(() => {
    if (
      canvasRef.current &&
      videoRef.current &&
      videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA
    ) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;

      const videoRatio = video.videoWidth / video.videoHeight;
      const canvasRatio = canvas.width / canvas.height;
      let drawWidth: number, drawHeight: number, x: number, y: number;

      // "object-cover" logic to fill the canvas
      if (videoRatio > canvasRatio) {
        drawHeight = canvas.height;
        drawWidth = drawHeight * videoRatio;
        x = (canvas.width - drawWidth) / 2;
        y = 0;
      } else {
        drawWidth = canvas.width;
        drawHeight = drawWidth / videoRatio;
        x = 0;
        y = (canvas.height - drawHeight) / 2;
      }

      ctx.drawImage(video, x, y, drawWidth, drawHeight);

      boundingBoxes.forEach((box) => {
        ctx.strokeStyle = '#7FBBFF';
        ctx.lineWidth = 4;
        const boxX = x + box.x * drawWidth;
        const boxY = y + box.y * drawHeight;
        const boxWidth = box.width * drawWidth;
        const boxHeight = box.height * drawHeight;

        ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

        const label = box.label;
        const padding = 8;
        const fontHeight = 18;
        ctx.font = `bold ${fontHeight}px "Space Mono"`;
        const textMetrics = ctx.measureText(label);

        // Label background
        ctx.fillStyle = '#7FBBFF';
        ctx.fillRect(
          boxX - 2,
          boxY - (fontHeight + padding) - 2,
          textMetrics.width + padding * 2 + 4,
          fontHeight + padding,
        );

        // Label text
        ctx.fillStyle = 'black';
        ctx.fillText(label, boxX + padding, boxY - padding / 2 - 2);
      });
    }
  }, [boundingBoxes]);

  useEffect(() => {
    let isMounted = true;
    let localAnimationFrameId: number;

    async function setupCameraAndStartSession() {
      const startAISession = async (stream: MediaStream) => {
        const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

        setConnectionState('connecting');
        setTranscripts([]);
        setBoundingBoxes([]);

        try {
          const inputAudioContext = new (window.AudioContext ||
            (window as any).webkitAudioContext)({sampleRate: 16000});
          inputAudioContextRef.current = inputAudioContext;

          const outputAudioContext = new (window.AudioContext ||
            (window as any).webkitAudioContext)({sampleRate: 24000});
          outputAudioContextRef.current = outputAudioContext;
          if (outputAudioContext.state === 'suspended') {
            setIsMuted(true);
          }

          let nextStartTime = 0;

          sessionPromiseRef.current = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Zephyr'}},
              },
              systemInstruction:
                'You are a helpful AI assistant. The user is streaming their camera and microphone to you. Your goal is to help them understand and interact with their environment. Answer their questions about what they are seeing. When you verbally refer to a specific object that is visible in the camera feed, you MUST use the provided `highlight_object` tool to draw a box around it. Be conversational and helpful.',
              tools: [
                {functionDeclarations: [highlightObjectFunctionDeclaration]},
              ],
              outputAudioTranscription: {},
              inputAudioTranscription: {},
            },
            callbacks: {
              onopen: () => {
                if (!isMounted) return;
                setConnectionState('connected');
                const source =
                  inputAudioContext.createMediaStreamSource(stream);
                const scriptProcessor =
                  inputAudioContext.createScriptProcessor(4096, 1, 1);
                scriptProcessorRef.current = scriptProcessor;

                scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                  const inputData =
                    audioProcessingEvent.inputBuffer.getChannelData(0);
                  const l = inputData.length;
                  const int16 = new Int16Array(l);
                  for (let i = 0; i < l; i++) {
                    int16[i] = inputData[i] * 32768;
                  }
                  const pcmBlob = {
                    data: encode(new Uint8Array(int16.buffer)),
                    mimeType: 'audio/pcm;rate=16000',
                  };
                  sessionPromiseRef.current?.then((session) => {
                    session.sendRealtimeInput({media: pcmBlob});
                  });
                };
                source.connect(scriptProcessor);
                scriptProcessor.connect(inputAudioContext.destination);

                if (frameIntervalRef.current)
                  clearInterval(frameIntervalRef.current);
                frameIntervalRef.current = window.setInterval(() => {
                  const tempCanvas = document.createElement('canvas');
                  if (videoRef.current && tempCanvas) {
                    tempCanvas.width = videoRef.current.videoWidth;
                    tempCanvas.height = videoRef.current.videoHeight;
                    tempCanvas
                      .getContext('2d')
                      ?.drawImage(
                        videoRef.current,
                        0,
                        0,
                        videoRef.current.videoWidth,
                        videoRef.current.videoHeight,
                      );
                    tempCanvas.toBlob(
                      async (blob) => {
                        if (blob) {
                          const base64Data = await blobToBase64(blob);
                          sessionPromiseRef.current?.then((session) => {
                            session.sendRealtimeInput({
                              media: {
                                data: base64Data,
                                mimeType: 'image/jpeg',
                              },
                            });
                          });
                        }
                      },
                      'image/jpeg',
                      JPEG_QUALITY,
                    );
                  }
                }, 1000 / FRAME_RATE);
              },
              onmessage: async (message: LiveServerMessage) => {
                if (!isMounted) return;
                if (message.serverContent?.inputTranscription) {
                  const text = message.serverContent.inputTranscription.text;
                  setTranscripts((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.source === 'user' && !last.isFinal) {
                      return [
                        ...prev.slice(0, -1),
                        {...last, text: last.text + text},
                      ];
                    }
                    return [...prev, {source: 'user', text, isFinal: false}];
                  });
                } else if (message.serverContent?.outputTranscription) {
                  const text = message.serverContent.outputTranscription.text;
                  setTranscripts((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.source === 'model' && !last.isFinal) {
                      return [
                        ...prev.slice(0, -1),
                        {...last, text: last.text + text},
                      ];
                    }
                    return [...prev, {source: 'model', text, isFinal: false}];
                  });
                }

                if (message.serverContent?.turnComplete) {
                  setTranscripts((prev) =>
                    prev.map((t) => ({...t, isFinal: true})),
                  );
                }

                if (message.toolCall?.functionCalls) {
                  for (const fc of message.toolCall.functionCalls as any[]) {
                    if (fc.name === 'highlight_object' && fc.args.box_2d) {
                      const [ymin, xmin, ymax, xmax] = fc.args.box_2d;
                      const newBox: BoundingBox2DType = {
                        x: xmin / 1000,
                        y: ymin / 1000,
                        width: (xmax - xmin) / 1000,
                        height: (ymax - ymin) / 1000,
                        label: fc.args.label,
                      };
                      setBoundingBoxes([newBox]); // Show one box at a time

                      if (boxTimeoutRef.current) {
                        clearTimeout(boxTimeoutRef.current);
                      }
                      boxTimeoutRef.current = window.setTimeout(() => {
                        setBoundingBoxes([]);
                        boxTimeoutRef.current = null;
                      }, 3000);
                    }

                    sessionPromiseRef.current?.then((session) => {
                      session.sendToolResponse({
                        functionResponses: {
                          id: fc.id,
                          name: fc.name,
                          response: {result: 'ok'},
                        },
                      });
                    });
                  }
                }

                const base64Audio =
                  message.serverContent?.modelTurn?.parts[0]?.inlineData.data;
                if (
                  base64Audio &&
                  outputAudioContextRef.current?.state === 'running'
                ) {
                  const oac = outputAudioContextRef.current;
                  nextStartTime = Math.max(nextStartTime, oac.currentTime);
                  const audioBuffer = await decodeAudioData(
                    decode(base64Audio),
                    oac,
                    24000,
                    1,
                  );
                  const source = oac.createBufferSource();
                  source.buffer = audioBuffer;
                  source.connect(oac.destination);
                  source.start(nextStartTime);
                  nextStartTime += audioBuffer.duration;
                }
              },
              onerror: (e: ErrorEvent) => {
                if (!isMounted) return;
                console.error(e);
                setConnectionState('error');
                stopAISession();
                if (e.message.includes('API key not valid')) {
                  alert(
                    'The provided API key is not valid. Please check the API_KEY environment variable.',
                  );
                }
              },
              onclose: (e: CloseEvent) => {
                if (!isMounted) return;
                setConnectionState('closed');
                stopAISession();
              },
            },
          });
        } catch (err) {
          if (!isMounted) return;
          console.error(err);
          setConnectionState('error');
          stopAISession();
        }
      };

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: {facingMode: 'environment'},
        });

        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        mediaStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        startAISession(stream);

        const drawLoop = () => {
          if (!isMounted) return;
          draw();
          localAnimationFrameId = requestAnimationFrame(drawLoop);
        };
        drawLoop();
      } catch (err) {
        console.error('Error accessing media devices.', err);
        if (isMounted) {
          alert(
            'Could not access camera/microphone. Please check permissions and refresh the page.',
          );
        }
      }
    }

    setupCameraAndStartSession();

    return () => {
      isMounted = false;
      cancelAnimationFrame(localAnimationFrameId);
      stopAISession();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw, stopAISession, setBoundingBoxes, setConnectionState]);

  const resumeAudio = useCallback(() => {
    if (
      outputAudioContextRef.current &&
      outputAudioContextRef.current.state === 'suspended'
    ) {
      outputAudioContextRef.current.resume().then(() => {
        setIsMuted(false);
      });
    }
  }, []);

  const statusInfo = {
    idle: {color: 'bg-gray-500', text: 'Initializing...'},
    connecting: {color: 'bg-yellow-500 animate-pulse', text: 'Connecting...'},
    connected: {color: 'bg-green-500', text: 'Connected'},
    error: {color: 'bg-red-500', text: 'Error'},
    closed: {color: 'bg-gray-500', text: 'Closed'},
  }[connectionState];

  return (
    <div
      className="w-screen h-screen relative overflow-hidden bg-black"
      onClick={resumeAudio}>
      <video ref={videoRef} className="hidden" playsInline muted></video>
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full"></canvas>

      {isMuted && connectionState === 'connected' && (
        <div
          className="absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center z-30 text-white cursor-pointer"
          aria-label="Enable audio"
          role="button">
          <div className="text-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-16 h-16 mx-auto mb-4">
              <path
                fillRule="evenodd"
                d="M1.5 4.5a3 3 0 0 1 3-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 0 1-.694 1.955l-1.293.97c-.135.101-.164.298-.083.465a15.3 15.3 0 0 0 6.88 6.88.75.75 0 0 0 .465-.083l.97-1.293a1.875 1.875 0 0 1 1.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 0 1-3 3h-2.25C6.34 22.5 1.5 17.66 1.5 8.25V6H4.5v2.25A.75.75 0 0 0 5.25 9h1.5a.75.75 0 0 0 .75-.75V6H4.5V4.5Z"
                clipRule="evenodd"
              />
            </svg>
            <p className="text-2xl font-bold">Tap to enable audio</p>
          </div>
        </div>
      )}

      {/* Status Indicator */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20">
        <div className="flex items-center gap-2 text-sm bg-black bg-opacity-60 text-white px-3 py-1 rounded-full">
          <div className={`w-3 h-3 rounded-full ${statusInfo.color}`}></div>
          <span>{statusInfo.text}</span>
        </div>
      </div>

      {/* Transcripts Overlay */}
      <div
        ref={transcriptContainerRef}
        className="absolute bottom-0 left-0 right-0 h-2/5 bg-gradient-to-t from-black via-black/70 to-transparent p-4 overflow-y-auto z-10 scroll-smooth">
        <div className="flex flex-col gap-3 pb-8">
          {transcripts.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-white z-0">
              <p className="max-w-xs text-center bg-black bg-opacity-50 p-4 rounded-lg">
                {connectionState === 'connected'
                  ? 'The session is live. Start speaking to the assistant.'
                  : 'Connecting to the AI assistant... Please wait.'}
              </p>
            </div>
          )}
          {transcripts.map((t, i) => (
            <div
              key={i}
              className={`flex gap-3 ${
                t.source === 'user' ? 'justify-end' : 'justify-start'
              }`}>
              {t.source === 'model' && (
                <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center flex-shrink-0">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-5 h-5 text-zinc-300">
                    <path d="M12 2a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0V3a1 1 0 0 1 1-1Zm0 18a1 1 0 0 1-1 1v1a1 1 0 0 1 2 0v-1a1 1 0 0 1-1-1Zm7-7a1 1 0 0 1 1 1h1a1 1 0 0 1 0 2h-1a1 1 0 0 1-1-1Zm-15 0a1 1 0 0 1-1-1H2a1 1 0 0 1 0-2h1a1 1 0 0 1 1 1Zm2.929-4.071a1 1 0 0 1 1.414 0l.707.707a1 1 0 0 1-1.414 1.414l-.707-.707a1 1 0 0 1 0-1.414Zm10.607 9.193a1 1 0 0 1 1.414 0l.707.707a1 1 0 0 1-1.414 1.414l-.707-.707a1 1 0 0 1 0-1.414ZM6.929 6.222a1 1 0 0 1 0 1.414l-.707.707A1 1 0 0 1 4.808 7.63l.707-.707a1 1 0 0 1 1.414 0Zm11.314 9.899a1 1 0 0 1 0 1.414l-.707.707a1 1 0 0 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0ZM12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z" />
                  </svg>
                </div>
              )}
              <div
                className={`rounded-lg px-4 py-2 max-w-[85%] backdrop-blur-sm ${
                  t.source === 'user'
                    ? 'bg-blue-600 bg-opacity-70'
                    : 'bg-zinc-800 bg-opacity-70'
                }`}>
                <p className="text-white whitespace-pre-wrap">{t.text}</p>
              </div>
              {t.source === 'user' && (
                <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center flex-shrink-0">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-5 h-5 text-zinc-300">
                    <path
                      fillRule="evenodd"
                      d="M7.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM3.751 20.105a8.25 8.25 0 0 1 16.498 0 .75.75 0 0 1-.437.695A18.683 18.683 0 0 1 12 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 0 1-.437-.695Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
