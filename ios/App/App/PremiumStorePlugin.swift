import Foundation
import Capacitor
import StoreKit
import os

/// Takken Learning Hub — StoreKit 2 Non-Consumable プラグイン。
///
/// セキュリティ境界:
/// - Product ID はプラグイン内部で固定。JS 側からの自由入力は受け付けない。
/// - Apple の verified transaction (`Transaction.currentEntitlements`) のみを
///   購入済みの正本とする。localStorage / JS 変数では解放しない。
/// - unverified transaction は解放せず finish もしない。
/// - 生の receipt・トランザクション詳細・個人情報はログに出力しない。
@objc(PremiumStorePlugin)
public class PremiumStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PremiumStorePlugin"
    public let jsName = "PremiumStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProduct", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getEntitlement", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
    ]

    /// 許可する唯一の Product ID（変更不可・呼出し側から指定不可）
    private static let productID = "com.kazushige.takkenlearninghub.premium"

    private static let log = Logger(
        subsystem: "com.kazushige.takkenlearninghub",
        category: "PremiumStore"
    )

    /// AppStore.sync() の連打防止（最短間隔・秒）
    private static let restoreMinInterval: TimeInterval = 15
    private var lastRestoreAt: Date?
    private var restoreInFlight = false

    private var updatesTask: Task<Void, Never>?

    override public func load() {
        // 起動中に届くトランザクション（Ask to Buy 承認・別端末購入・refund 等）を
        // 常駐処理する。verified のみ finish する。
        updatesTask = Task.detached(priority: .background) { [weak self] in
            for await result in Transaction.updates {
                if case .verified(let tx) = result {
                    // 自プロダクト以外の transaction は消費しない（将来の別ハンドラ用に残す）
                    guard tx.productID == Self.productID else { continue }
                    // pending 確定（Ask to Buy 承認）・別端末購入・refund / revoke を含む。
                    // finish 後に正本（currentEntitlements）を再評価して JS へ通知する。
                    Self.log.info("transaction update: verified (finishing)")
                    await tx.finish()
                    let entitled = await Self.evaluateEntitlement()
                    Self.log.info("transaction update: entitlement -> \(entitled ? "entitled" : "notEntitled", privacy: .public)")
                    self?.notifyListeners("entitlementChanged", data: [
                        "entitled": entitled,
                        "state": entitled ? "entitled" : "notEntitled",
                    ])
                } else {
                    Self.log.warning("transaction update: unverified (ignored, not finished)")
                }
            }
        }
        Self.log.info("PremiumStore plugin loaded")
    }

    deinit {
        updatesTask?.cancel()
    }

    // MARK: - API

    /// 商品情報（ローカライズ済み価格を含む）を返す。
    @objc func getProduct(_ call: CAPPluginCall) {
        Task {
            do {
                guard let product = try await Self.fetchProduct() else {
                    call.reject("Product not found", "PRODUCT_NOT_FOUND")
                    return
                }
                call.resolve([
                    "productId": product.id,
                    "displayName": product.displayName,
                    "description": product.description,
                    "displayPrice": product.displayPrice,
                ])
            } catch {
                Self.log.warning("getProduct failed: store unavailable")
                call.reject("Store unavailable", "STORE_UNAVAILABLE")
            }
        }
    }

    /// 現在のエンタイトルメントを Apple の verified transaction から評価して返す。
    /// debugBuild は iOS DEBUG ビルド判定（課金テスト導線の表示制御用）。
    @objc func getEntitlement(_ call: CAPPluginCall) {
        Task {
            let entitled = await Self.evaluateEntitlement()
            #if DEBUG
            let debugBuild = true
            #else
            let debugBuild = false
            #endif
            Self.log.info("getEntitlement: \(entitled ? "entitled" : "notEntitled", privacy: .public)")
            call.resolve([
                "entitled": entitled,
                "state": entitled ? "entitled" : "notEntitled",
                "productId": Self.productID,
                "debugBuild": debugBuild,
            ])
        }
    }

    /// 購入を開始する。結果は purchased / cancelled / pending のいずれか。
    @objc func purchase(_ call: CAPPluginCall) {
        Task {
            do {
                guard let product = try await Self.fetchProduct() else {
                    call.reject("Product not found", "PRODUCT_NOT_FOUND")
                    return
                }
                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    switch verification {
                    case .verified(let tx):
                        await tx.finish()
                        Self.log.info("purchase: success verified")
                        call.resolve(["state": "purchased", "entitled": true])
                    case .unverified:
                        // 検証不能なトランザクションでは解放しない・finish しない
                        Self.log.warning("purchase: unverified (not unlocked)")
                        call.reject("Transaction could not be verified", "UNVERIFIED")
                    }
                case .userCancelled:
                    Self.log.info("purchase: cancelled by user")
                    call.resolve(["state": "cancelled", "entitled": false])
                case .pending:
                    Self.log.info("purchase: pending")
                    call.resolve(["state": "pending", "entitled": false])
                @unknown default:
                    call.reject("Unknown purchase result", "PURCHASE_FAILED")
                }
            } catch {
                Self.log.warning("purchase failed")
                call.reject("Purchase failed", "PURCHASE_FAILED")
            }
        }
    }

    /// 購入復元。ユーザー操作起点でのみ呼ばれる想定。AppStore.sync() 後に再評価する。
    @objc func restore(_ call: CAPPluginCall) {
        Task { @MainActor in
            if restoreInFlight {
                call.reject("Restore already in progress", "RESTORE_IN_PROGRESS")
                return
            }
            if let last = lastRestoreAt,
               Date().timeIntervalSince(last) < Self.restoreMinInterval {
                call.reject("Restore requested too frequently", "RESTORE_THROTTLED")
                return
            }
            restoreInFlight = true
            lastRestoreAt = Date()
            defer { restoreInFlight = false }

            do {
                try await AppStore.sync()
            } catch {
                // ユーザーによる認証キャンセル等。エンタイトルメントは変更しない。
                Self.log.info("restore: sync failed or cancelled")
                call.reject("Restore failed", "RESTORE_FAILED")
                return
            }
            let entitled = await Self.evaluateEntitlement()
            Self.log.info("restore: \(entitled ? "entitled" : "notEntitled", privacy: .public)")
            call.resolve([
                "entitled": entitled,
                "state": entitled ? "entitled" : "notEntitled",
                "productId": Self.productID,
            ])
        }
    }

    // MARK: - Core

    private static func fetchProduct() async throws -> Product? {
        let products = try await Product.products(for: [productID])
        return products.first(where: { $0.id == productID })
    }

    /// verified かつ revoke されていない currentEntitlements のみを購入済みと認める。
    private static func evaluateEntitlement() async -> Bool {
        for await result in Transaction.currentEntitlements {
            guard case .verified(let tx) = result else { continue }
            if tx.productID == productID && tx.revocationDate == nil {
                return true
            }
        }
        return false
    }
}
