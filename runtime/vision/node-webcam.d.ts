// Type declarations for node-webcam
declare module 'node-webcam' {
  interface WebcamOptions {
    width?: number;
    height?: number;
    quality?: number;
    output?: 'jpeg' | 'png';
    device?: string;
    callbackReturn?: 'location' | 'buffer';
    verbose?: boolean;
  }

  interface Webcam {
    capture(filename: string, callback: (err: Error | null, data: Buffer) => void): void;
  }

  function create(options?: WebcamOptions): Webcam;

  export = { create };
}
