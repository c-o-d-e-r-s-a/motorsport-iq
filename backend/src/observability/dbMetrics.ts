import { metrics } from './metrics';

export function trackDbWrite(operation: string): void {
  metrics.incrementCounter('db.write_total');
  metrics.incrementCounter(`db.write.${operation}`);
}

export function trackDbQuery(operation: string): void {
  metrics.incrementCounter('db.query_total');
  metrics.incrementCounter(`db.query.${operation}`);
}
