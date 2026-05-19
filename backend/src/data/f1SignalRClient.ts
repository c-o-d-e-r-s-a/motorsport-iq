import zlib from 'node:zlib';
const signalr = require('signalr-client');


import { OpenF1Position, OpenF1Lap } from '../types'; 

export interface F1SignalRClientOptions {
    onPositionUpdate?: (positions: OpenF1Position[]) => void;
    onLapCompletion?: (lap: OpenF1Lap) => void;
    onConnectionLoss?: () => void;
    onConnectionRestored?: () => void;
    onConnectionClosedPermanently?: () => void;
  }

export class F1SignalRClient {
  private client: any = null;

  constructor(private options: F1SignalRClientOptions = {}) {
    const url = "https://livetiming.formula1.com/signalr";
    const hubs = ["StreamingHub"];
    
    this.client = new signalr.client(url, hubs);

    this.client.on("StreamingHub", "Position", (compressedData: string) => {
      const rawJson = this.decompressPayload(compressedData);
      if (rawJson) {
        this.handlePositionData(rawJson);
      }
    });

    this.client.on("StreamingHub", "TimingData", (compressedData: string) => {
      const rawJson = this.decompressPayload(compressedData);
      if (rawJson) {
        this.handleTimingData(rawJson);
      }
    });
  }

  // Helper method to handle F1's Base64 + zlib compression
  private decompressPayload(base64Payload: string): any {
    try {
      if (!base64Payload) return null;
      const buffer = Buffer.from(base64Payload, 'base64');
      // F1 uses raw deflate (no zlib headers)
      const decompressed = zlib.inflateRawSync(buffer); 
      return JSON.parse(decompressed.toString('utf-8'));
    } catch (err) {
      console.error("[SignalR Decoder] Error decompressing packet:", err);
      return null;
    }
  }

  // Mapping F1 stream positions into existing OpenF1 models
  private handlePositionData(data: any) {
    // F1 payloads contain a timestamp ('R') and entries array ('P')
    const timestamp = data.R; 
    if (!data.P) return;

    const mappedPositions: OpenF1Position[] = data.P.map((driverPacket: any) => ({
      driver_number: parseInt(driverPacket.DriverNumber, 10),
      position: driverPacket.Position,
      date: timestamp,
      // SignalR doesn't broadcast these static fields, seed defaults
      meeting_key: 0,
      session_key: 0,
    }));

    if (mappedPositions.length > 0) {
      this.options.onPositionUpdate?.(mappedPositions);
    }
  }

  private handleTimingData(data: any) {
    if (!data.Lines) return;

    Object.keys(data.Lines).forEach((driverNumber) => {
      const lineData = data.Lines[driverNumber];
      
      if (lineData.LastLapTime && lineData.LastLapTime.Value) {
        const mappedLap: OpenF1Lap = {
          driver_number: parseInt(driverNumber, 10),
          lap_number: lineData.NumberOfLaps || 0,
          lap_duration: lineData.LastLapTime.Value,
          is_pit_out_lap: false,
          
          // default values for the static fields SignalR doesn't broadcast
          session_key: 0,
          meeting_key: 0,
          lap_time: lineData.LastLapTime.Value, // Fallback to duration string
          date_start: new Date().toISOString(),
          
          // SignalR doesn't provide sector-level telemetry, using null defaults
          duration_sector_1: null,
          duration_sector_2: null,
          duration_sector_3: null,
          segments_sector_1: [],
          segments_sector_2: [],
          segments_sector_3: [],
        };
        
        this.options.onLapCompletion?.(mappedLap);
      }
    });
  }

  async start(): Promise<void> {
    if (!this.client) return;
    this.client.start();
  
    this.client.serviceHandlers.connected = () => {
      console.log("[SignalR] Connected & Streaming.");
      this.options.onConnectionRestored?.(); // Alert runtime we are healthy
      
      const streamingHub = this.client.hub("StreamingHub");
      if (streamingHub) {
        streamingHub.invoke("Subscribe", ["Position", "TimingData"]);
      }
    };
  
    // Legacy library fires re-connecting loops here
    this.client.serviceHandlers.reconnecting = () => {
      console.warn("[SignalR] Connection lost, attempting reconnect...");
      this.options.onConnectionLoss?.();
    };
  
    // If the library completely gives up or encounters a fatal protocol drop
    this.client.serviceHandlers.connectFailed = (error: any) => {
      console.error("[SignalR] Connection Failed/Closed:", error);
      this.options.onConnectionClosedPermanently?.();
    };
  }

  async stop(): Promise<void> {
    if (this.client) this.client.end();
  }
}