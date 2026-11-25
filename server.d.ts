import type http from "http";
import type { Express } from "express";

export function createMarketingOsApp(httpServer?: http.Server): Promise<Express>;
