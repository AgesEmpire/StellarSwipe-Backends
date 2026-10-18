# Upload Content Hash & Checksum Verification

This document specifies the server-side integrity and checksum verification mechanisms enforced for uploaded files before promoting them to durable storage.

## Overview

When clients upload files to the `/storage/upload/single` endpoint, `FileUploadService` validates their integrity using cryptographic hash digests to prevent corruption in transit or tampered payloads.

## Supported Checksum Algorithms

Clients can specify an expected checksum and algorithm via request headers:

* `x-checksum`: Hex-encoded cryptographic digest representing the expected content of the file.
* `x-checksum-algorithm`: Cryptographic hash algorithm. Supported values:
  - `sha256` (Default)
  - `sha512`
  - `md5`

If an unsupported algorithm is specified, the server immediately rejects the request with HTTP `400 Bad Request` (`Unsupported checksum algorithm: '<algorithm>'`).

## Streaming Verification Without Buffering

To maintain low memory overhead during large file uploads:
1. Incoming multipart upload streams are received and streamed directly to a temporary scratch location.
2. The server-side cryptographic digest is computed on-the-fly via Node.js crypto streams (`crypto.createHash(...)`) as data chunks arrive.
3. Once the stream ends, the calculated digest is compared against the client-provided `x-checksum` using constant-time comparison (`crypto.timingSafeEqual`) to prevent timing side channels.

## Mismatch & Failure Behavior

* **Missing Checksum**: If no `x-checksum` header is provided by the client, the server computes the default `sha256` content digest for deduplication/tracking and promotes the file directly to durable storage.
* **Checksum Match**: If the client provides `x-checksum` and it matches the server-calculated digest, the temporary file is promoted (atomically moved) to permanent durable storage under the date-partitioned storage path.
* **Checksum Mismatch**: If `x-checksum` does not match the server-calculated digest, the upload is aborted, the temporary scratch file is unlinked immediately, and the request fails with HTTP `400 Bad Request`:
  ```json
  {
    "statusCode": 400,
    "message": "Checksum verification failed for algorithm 'sha256': expected <expected>, calculated <actual>",
    "error": "Bad Request"
  }
  ```
