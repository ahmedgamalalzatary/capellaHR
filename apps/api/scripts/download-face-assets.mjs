import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelRoot = path.join(apiRoot, 'assets', 'face-models');
const fixtureRoot = path.join(tmpdir(), 'capella-face-test-fixtures');

const models = [
  ['yunet.onnx', 'https://media.githubusercontent.com/media/opencv/opencv_zoo/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet/face_detection_yunet_2023mar.onnx', '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4'],
  ['sface.onnx', 'https://media.githubusercontent.com/media/opencv/opencv_zoo/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_recognition_sface/face_recognition_sface_2021dec.onnx', '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79'],
  ['YUNET-LICENSE', 'https://raw.githubusercontent.com/opencv/opencv_zoo/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet/LICENSE', 'c83b8120c50ccbd4c4f96edf53141bdd566ebb8f8e9227e415326aa1b1aba958'],
  ['SFACE-LICENSE', 'https://raw.githubusercontent.com/opencv/opencv_zoo/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_recognition_sface/LICENSE', 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30'],
];

const fixtures = [
  ['person-a-1.jpg', 'https://raw.githubusercontent.com/ageitgey/face_recognition/9f3061aaeed9a8756d2c970f5dfe066617a8281d/examples/obama.jpg', '0930e3aa8cae5920329c0c8cbc6a2ab70f47b0e67b432875beaa95cbf7e741f6'],
  ['person-a-2.jpg', 'https://raw.githubusercontent.com/ageitgey/face_recognition/9f3061aaeed9a8756d2c970f5dfe066617a8281d/examples/obama2.jpg', 'a7efcc907375274796f39646510704aa86672d59f6d5469d69af3c85590976a6'],
  ['person-b-1.jpg', 'https://raw.githubusercontent.com/opencv/opencv/0e09f1a23885eee460ade65fe51950b80bc8f49c/samples/data/lena.jpg', '7de7ed51a1594fff247f4cae2301eceacf5313d6011e37b4a4c8733f7bb72c07'],
];

const digest = (data) => createHash('sha256').update(data).digest('hex');

const download = async (url) => {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};

const ensureFile = async (root, [name, url, expectedHash]) => {
  const destination = path.join(root, name);
  try {
    if (digest(await readFile(destination)) === expectedHash) return;
  } catch {}

  const data = await download(url).catch((error) => {
    throw new Error(`Failed to download ${name}`, { cause: error });
  });
  const actualHash = digest(data);
  if (actualHash !== expectedHash) throw new Error(`Checksum mismatch for ${name}: ${actualHash}`);
  await mkdir(root, { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, data);
  await rm(destination, { force: true });
  await rename(temporary, destination);
};

const selection = process.argv[2] ?? 'models';
if (!['models', 'test', 'all'].includes(selection)) throw new Error(`Unknown face asset selection: ${selection}`);
if (selection === 'models' || selection === 'all') for (const asset of models) await ensureFile(modelRoot, asset);
if (selection === 'test' || selection === 'all') for (const asset of fixtures) await ensureFile(fixtureRoot, asset);
