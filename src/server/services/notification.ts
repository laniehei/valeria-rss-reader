import type { NotificationEvent } from '../../shared/types';

type Subscriber = (event: NotificationEvent) => Promise<void>;

class NotificationService {
  private subscribers = new Map<string, Subscriber>();

  subscribe(clientId: string, callback: Subscriber): () => void {
    this.subscribers.set(clientId, callback);

    return () => {
      this.subscribers.delete(clientId);
    };
  }

  async broadcast(event: NotificationEvent): Promise<void> {
    const promises = Array.from(this.subscribers.values()).map((callback) =>
      callback(event).catch(console.error)
    );

    await Promise.all(promises);
  }

  getClientCount(): number {
    return this.subscribers.size;
  }
}

export const notificationService = new NotificationService();
