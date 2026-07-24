import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  classifyDetectedFaces,
  cosineSimilarity,
  createOnnxFaceGateway,
  onnxSessionOptions,
} from '../../src/modules/attendance/onnx-face-gateway.js';

describe('ONNX face gateway helpers', () => {
  it('classifies zero, one, and multiple detected faces', () => {
    expect(classifyDetectedFaces(0)).toBe('face_not_found');
    expect(classifyDetectedFaces(1)).toBe('one');
    expect(classifyDetectedFaces(2)).toBe('multiple_faces');
  });

  it('compares normalized descriptors without exposing a score', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
    expect(cosineSimilarity([0, 0], [1, 0])).toBeNull();
  });

  it('suppresses ONNX informational and warning logs while preserving errors', () => {
    expect(onnxSessionOptions).toEqual({ logSeverityLevel: 3 });
    expect(Object.isFrozen(onnxSessionOptions)).toBe(true);
  });
});

describe('ONNX face gateway runtime', () => {
  const fixtureRoot = path.join(tmpdir(), 'capella-face-test-fixtures');
  const fixture = (name: string) => readFile(path.join(fixtureRoot, name));
  afterAll(() => rm(fixtureRoot, { recursive: true, force: true }));

  it('matches two different photos of one person and rejects another person', async () => {
    const reference = await fixture('person-a-1.jpg');
    const samePerson = await fixture('person-a-2.jpg');
    const differentPerson = await fixture('person-b-1.jpg');
    const gateway = createOnnxFaceGateway(async () => reference);

    await expect(gateway.compare('personal.jpg', samePerson)).resolves.toEqual({ kind: 'match' });
    await expect(gateway.compare('personal.jpg', differentPerson)).resolves.toEqual({ kind: 'mismatch' });
  }, 120_000);
});
