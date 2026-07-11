import UIKit
import Capacitor
import os

/// ローカルプラグイン（PremiumStore）を Capacitor bridge に登録するための
/// CAPBridgeViewController サブクラス。Main.storyboard から参照される。
class AppViewController: CAPBridgeViewController {

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PremiumStorePlugin())
        #if DEBUG
        // DEBUG ビルド限定の JS ブリッジ自己診断。
        // 本番 UI には一切露出しない（Release ビルドには含まれない）。
        scheduleBridgeSelfCheck(attempt: 0)
        #endif
    }

    #if DEBUG
    private static let log = Logger(
        subsystem: "com.kazushige.takkenlearninghub",
        category: "PremiumStoreSelfCheck"
    )

    private func scheduleBridgeSelfCheck(attempt: Int) {
        guard attempt < 5 else {
            Self.log.error("selfcheck: giving up after retries")
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
            self?.runBridgeSelfCheck(attempt: attempt)
        }
    }

    private func runBridgeSelfCheck(attempt: Int) {
        guard let webView = self.webView else { return }
        let js = """
        const ent = await window.Capacitor.Plugins.PremiumStore.getEntitlement();
        let productState;
        try {
          const p = await window.Capacitor.Plugins.PremiumStore.getProduct();
          productState = 'ok:' + (typeof p.displayPrice === 'string' ? 'hasPrice' : 'noPrice');
        } catch (e) {
          productState = 'error:' + (e && e.code ? e.code : 'unknown');
        }
        return { entitled: ent.entitled, state: ent.state, product: productState };
        """
        webView.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value):
                if let dict = value as? [String: Any] {
                    let entitled = String(describing: dict["entitled"] ?? "nil")
                    let state = String(describing: dict["state"] ?? "nil")
                    let product = String(describing: dict["product"] ?? "nil")
                    Self.log.info("selfcheck ok entitled=\(entitled, privacy: .public) state=\(state, privacy: .public) product=\(product, privacy: .public)")
                } else {
                    Self.log.warning("selfcheck: unexpected result shape")
                }
            case .failure:
                Self.log.info("selfcheck attempt \(attempt, privacy: .public) failed; retrying")
                self.scheduleBridgeSelfCheck(attempt: attempt + 1)
            }
        }
    }
    #endif
}
