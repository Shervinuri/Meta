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

import {useAtom} from 'jotai';
// Fix: Import `useEffect` and `useState` to handle asynchronous image loading within the component.
import React, {useEffect, useState} from 'react';
import {ImageSrcAtom, IsUploadedImageAtom} from './atoms';
import {imageOptions as imageFileNames} from './consts';
import {useResetState} from './hooks';

export function ExampleImages() {
  const [, setImageSrc] = useAtom(ImageSrcAtom);
  const [, setIsUploadedImage] = useAtom(IsUploadedImageAtom);
  const resetState = useResetState();
  const [imageUrls, setImageUrls] = useState<string[]>([]);

  // Fix: Move image fetching logic from `consts.tsx` into a `useEffect` hook.
  // This removes the top-level await that was causing module loading and type inference issues.
  useEffect(() => {
    const fetchImages = async () => {
      const urls = await Promise.all(
        imageFileNames.map(async (fileName) => {
          const res = await fetch(
            `https://storage.googleapis.com/generativeai-downloads/images/robotics/applet-robotics-spatial-understanding/${fileName}`,
          );
          const blob = await res.blob();
          return URL.createObjectURL(blob);
        }),
      );
      setImageUrls(urls);
    };

    fetchImages();

    return () => {
      // Clean up Object URLs to prevent memory leaks.
      imageUrls.forEach((url) => URL.revokeObjectURL(url));
    };
    // The dependency on `imageUrls` is omitted in the cleanup function to prevent re-running.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-wrap items-start gap-3 shrink-0 w-[190px]">
      {imageUrls.map((image) => (
        <button
          key={image}
          className="p-0 w-[56px] h-[56px] relative overflow-hidden"
          onClick={() => {
            setIsUploadedImage(false);
            setImageSrc(image);
            resetState();
          }}>
          <img
            src={image}
            className="absolute left-0 top-0 w-full h-full object-cover"
          />
        </button>
      ))}
    </div>
  );
}
