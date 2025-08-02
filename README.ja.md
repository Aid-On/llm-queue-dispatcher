# @aid-on/llm-queue-dispatcher

> 🧠 高度なスコアリングアルゴリズムとレート制限対応を備えたLLMリクエスト用キューディスパッチャー

[![npm version](https://badge.fury.io/js/%40aid-on%2Fllm-queue-dispatcher.svg)](https://www.npmjs.com/package/@aid-on/llm-queue-dispatcher)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

## 概要

`@aid-on/llm-queue-dispatcher`は、LLM（大規模言語モデル）リクエスト処理に特化した高度なキューイングシステムです。優先度、トークン効率、待機時間、レート制限制約など複数の要因に基づいて、最適なリクエストをインテリジェントに選択する高度なスコアリングアルゴリズムを使用します。

🚀 **[インタラクティブデモを試す](https://aid-on-libs.github.io/llm-queue-dispatcher/)** - リアルタイム可視化でキューの動作を体験！

## 特徴

- 🎯 **多次元スコアリング**: 優先度、効率性、待機時間、リトライ回数、トークンフィット、処理時間を考慮
- ⚡ **レートリミッター統合**: `@aid-on/llm-throttle`とシームレスに連携してレート対応処理を実現
- 🔄 **プリフェッチサポート**: スループット向上のためのオプションメッセージプリフェッチ
- 🗂️ **抽象ストレージ**: プラガブルストレージアダプター（インメモリ付属、SQS、Redisなどに拡張可能）
- 📊 **豊富なメトリクス**: 包括的な監視とパフォーマンスメトリクス
- 🏭 **ファクトリー関数**: 一般的な用途向けの事前設定済みキュータイプ
- 🧪 **TypeScriptファースト**: 完全型付きで優れたIDE支援

## インストール

```bash
npm install @aid-on/llm-queue-dispatcher
```

## クイックスタート

### 基本的な使用方法

```typescript
import { createInMemoryLLMQueueDispatcher, Priority } from '@aid-on/llm-queue-dispatcher';
import { createLLMThrottle } from '@aid-on/llm-throttle';

// キューとレートリミッターを作成
const queue = createInMemoryLLMQueueDispatcher();
const rateLimiter = createLLMThrottle({ rpm: 60, tpm: 10000 });

// リクエストをエンキュー
await queue.enqueue({
  id: 'req-1',
  payload: { prompt: 'こんにちは、世界！' },
  priority: Priority.HIGH,
  tokenInfo: { estimated: 150 },
  createdAt: new Date()
});

// メッセージを処理
const processable = await queue.dequeue(rateLimiter);
if (processable) {
  try {
    // LLM処理ロジックをここに記述
    const result = await processLLMRequest(processable.message.payload);
    await processable.markAsProcessed();
  } catch (error) {
    await processable.markAsFailed(error);
  }
}
```

### カスタムストレージ

```typescript
import { createLLMQueueDispatcher } from '@aid-on/llm-queue-dispatcher';

// ストレージアダプターを実装
class SQSStorage implements QueueStorageAdapter {
  async enqueue(message) { /* SQS実装 */ }
  async dequeue(limit, timeout) { /* SQS実装 */ }
  // ... その他のメソッド
}

const queue = createLLMQueueDispatcher(new SQSStorage(), {
  enablePrefetch: true,
  bufferSize: 100
});
```

## APIリファレンス

### コアクラス

#### `LLMQueueDispatcher<T>`

インテリジェントなメッセージ選択と処理を行うメインキュークラス。

```typescript
class LLMQueueDispatcher<T = LLMPayload> {
  constructor(storage: QueueStorageAdapter<LLMRequest<T>>, config?: LLMQueueDispatcherConfig)
  
  async enqueue(request: LLMRequest<T>): Promise<void>
  async batchEnqueue(requests: LLMRequest<T>[]): Promise<void>
  async dequeue(rateLimiter: LLMThrottle): Promise<ProcessableMessage<T> | null>
  async getQueueMetrics(): Promise<QueueMetrics>
  async purge(): Promise<void>
  stop(): void
}
```

#### 設定

```typescript
interface LLMQueueDispatcherConfig {
  bufferSize?: number;                    // プリフェッチバッファサイズ（デフォルト: 50）
  enablePrefetch?: boolean;               // メッセージプリフェッチを有効化（デフォルト: false）
  prefetchInterval?: number;              // プリフェッチ間隔（ミリ秒）（デフォルト: 5000）
  maxCandidatesToEvaluate?: number;       // スコア計算対象の最大メッセージ数（デフォルト: 20）
  minScoreThreshold?: number;             // 処理最小スコア（デフォルト: 0.1）
  scoring?: ScoringConfig;                // カスタムスコアリング設定
  metricsRetentionMs?: number;            // メトリクス保持時間
  logger?: Logger;                        // カスタムロガー
}
```

### ファクトリー関数

#### `createInMemoryQueue<T>(config?)`
インメモリストレージを使用するキューを作成（テストと開発に最適）。

#### `createPrefetchingQueue<T>(storage, config?)`
高スループットシナリオ用にプリフェッチを有効にしたキューを作成。

#### `createSimplePriorityQueue<T>(storage, config?)`
主に優先度ベースの選択を使用するキューを作成。

#### `createThroughputOptimizedQueue<T>(storage, config?)`
最大スループットとTPM効率に最適化されたキューを作成。

#### `createFairQueue<T>(storage, config?)`
公平性と優先度のバランスを取るキューを作成（FIFO風動作）。

### メッセージタイプ

```typescript
interface LLMRequest<T = LLMPayload> {
  id: string;
  payload: T;
  priority: Priority;
  tokenInfo: TokenInfo;
  expectedProcessingTime?: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

enum Priority {
  URGENT = 0,   // 緊急
  HIGH = 1,     // 高
  NORMAL = 2,   // 通常
  LOW = 3       // 低
}
```

## 高度な使用方法

### カスタムスコアリング

```typescript
const queue = createLLMQueueDispatcher(storage, {
  scoring: {
    weights: {
      priority: 0.3,        // 優先度
      efficiency: 0.25,     // 効率性
      waitTime: 0.25,       // 待機時間
      retry: 0.1,           // リトライペナルティ
      tokenFit: 0.1,        // トークンフィット
      processingTime: 0.0   // 処理時間
    },
    customScorers: [{
      name: 'deadline',
      weight: 0.2,
      calculate: (message, context) => {
        const deadline = message.payload.metadata?.deadline as number;
        if (!deadline) return 0.5;
        const timeLeft = deadline - context.currentTime;
        return Math.max(0, Math.min(1, timeLeft / 3600000)); // 最大1時間
      }
    }]
  }
});
```

### ストレージアダプター実装

```typescript
class RedisStorage implements QueueStorageAdapter<LLMRequest> {
  constructor(private redis: Redis) {}
  
  async enqueue(message: LLMRequest): Promise<QueueMessage<LLMRequest>> {
    const queueMessage = {
      id: generateId(),
      payload: message,
      attributes: {
        messageId: generateId(),
        receiptHandle: generateHandle(),
        enqueuedAt: new Date(),
        receiveCount: 0
      }
    };
    
    await this.redis.lpush('queue', JSON.stringify(queueMessage));
    return queueMessage;
  }
  
  async dequeue(limit: number, visibilityTimeout: number): Promise<QueueMessage<LLMRequest>[]> {
    // Redisの可視性タイムアウトロジック実装
    // ...
  }
  
  // その他の必要なメソッドを実装...
}
```

### 監視とメトリクス

```typescript
const metrics = await queue.getQueueMetrics();

console.log(`総メッセージ数: ${metrics.queue.totalMessages}`);
console.log(`処理中: ${metrics.processing.activeRequests}`);
console.log(`スループット: ${metrics.queue.throughput.messagesPerMinute} msg/min`);
console.log(`バッファ使用率: ${metrics.performance.bufferUtilization * 100}%`);
```

## LLM Throttleとの統合

キューは`@aid-on/llm-throttle`とシームレスに連携するよう設計されています：

```typescript
import { createLLMThrottle } from '@aid-on/llm-throttle';

const rateLimiter = createLLMThrottle({
  rpm: 60,        // 毎分60リクエスト
  tpm: 10000,     // 毎分10,000トークン
  burstTPM: 15000 // 最大15,000 TPMまでのバーストを許可
});

// キューはメッセージ選択時に自動的にレート制限を考慮
const processable = await queue.dequeue(rateLimiter);
```

## エラー処理

```typescript
const processable = await queue.dequeue(rateLimiter);
if (processable) {
  try {
    const result = await processLLMRequest(processable.message.payload);
    await processable.markAsProcessed();
  } catch (error) {
    if (error.code === 'RATE_LIMITED') {
      // 後でリトライするために可視性タイムアウトを延長
      await processable.updateVisibility(300); // 5分
    } else {
      // その他のエラーは失敗としてマーク
      await processable.markAsFailed(error);
    }
  }
}
```

## デモ

インテリジェントキューの動作を確認するインタラクティブデモを探索：

```bash
# リポジトリをクローン
git clone https://github.com/aid-on-libs/llm-queue-dispatcher.git
cd llm-queue-dispatcher

# 依存関係をインストール
npm install

# デモサーバーを起動
npm run demo:dev
```

デモの機能：
- **リアルタイムキュー可視化**: 保留中、処理中、完了状態を移動するメッセージを確認
- **インタラクティブレート制限**: RPM/TPM制限を調整してメッセージ選択への影響を確認
- **スコアリングアルゴリズム実演**: 各メッセージの詳細なスコア内訳を表示
- **複数のキュータイプ**: 異なる事前設定されたキュー戦略を比較
- **ライブメトリクスダッシュボード**: スループット、効率性、パフォーマンスメトリクスを監視

## テスト

ライブラリには包括的なテストユーティリティが含まれています：

```typescript
import { createInMemoryLLMQueueDispatcher } from '@aid-on/llm-queue-dispatcher';

// インメモリキューはテストに最適
const testQueue = createInMemoryQueue();

// キュー処理ロジックをテスト
await testQueue.enqueue(mockRequest);
const processable = await testQueue.dequeue(mockRateLimiter);
expect(processable).toBeDefined();
```

## パフォーマンスのヒント

1. **プリフェッチを有効化**: 高スループットシナリオでは、プリフェッチを有効にしてデキューレイテンシを削減
2. **バッファサイズの調整**: 大きなバッファはより多くの選択肢を提供するが、より多くのメモリを使用
3. **スコアリングの最適化**: 特定の要件に基づいてスコアリング重みを調整
4. **メトリクスの監視**: 内蔵メトリクスを使用してボトルネックを特定
5. **カスタムストレージ**: インフラストラクチャに最適化されたストレージアダプターを実装

## ライセンス

MIT © aid-on

## 貢献

貢献を歓迎します！問題と貢献ガイドラインについては、[GitHubリポジトリ](https://github.com/aid-on-libs/llm-queue-dispatcher)をご確認ください。

---

より多くの例と詳細なドキュメントについては、[GitHub Pagesサイト](https://aid-on-libs.github.io/llm-queue-dispatcher/)をご覧ください。