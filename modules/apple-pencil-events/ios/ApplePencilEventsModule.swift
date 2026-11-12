import ExpoModulesCore
import UIKit

public final class ApplePencilEventsModule: Module {
  private lazy var handler = PencilInteractionHandler { [weak self] action in
    self?.sendEvent("onDoubleTap", ["action": action])
  }

  public func definition() -> ModuleDefinition {
    Name("ApplePencilEvents")
    Events("onDoubleTap")
    OnStartObserving("onDoubleTap") { self.handler.installInteraction() }
    OnStopObserving("onDoubleTap") { self.handler.removeInteraction() }
    OnDestroy { self.handler.removeInteraction() }
  }
}

private final class PencilInteractionHandler: NSObject, UIPencilInteractionDelegate {
  private let onDoubleTap: (String) -> Void
  private weak var attachedView: UIView?
  private var pencilInteraction: UIPencilInteraction?
  private var lastTapUptime: TimeInterval = 0

  init(onDoubleTap: @escaping (String) -> Void) {
    self.onDoubleTap = onDoubleTap
    super.init()
  }

  func installInteraction() {
    DispatchQueue.main.async { [weak self] in
      guard let self, self.pencilInteraction == nil, let view = Self.activeRootView() else { return }
      let interaction = UIPencilInteraction()
      interaction.delegate = self
      interaction.isEnabled = true
      view.addInteraction(interaction)
      self.attachedView = view
      self.pencilInteraction = interaction
    }
  }

  func removeInteraction() {
    DispatchQueue.main.async { [self] in
      if let interaction = self.pencilInteraction {
        self.attachedView?.removeInteraction(interaction)
      }
      self.pencilInteraction = nil
      self.attachedView = nil
    }
  }

  private static func activeRootView() -> UIView? {
    let windows = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
    let window = windows.first(where: \.isKeyWindow) ?? windows.first
    var controller = window?.rootViewController
    while let presented = controller?.presentedViewController { controller = presented }
    return controller?.view ?? window
  }

  private func emitDoubleTap() {
    let uptime = ProcessInfo.processInfo.systemUptime
    guard uptime - lastTapUptime > 0.15 else { return }
    lastTapUptime = uptime
    let action: String
    switch UIPencilInteraction.preferredTapAction {
    case .switchEraser: action = "switchEraser"
    case .switchPrevious: action = "switchPrevious"
    case .showColorPalette: action = "showColorPalette"
    case .ignore: action = "ignore"
    @unknown default: action = "unknown"
    }
    onDoubleTap(action)
  }

  func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
    emitDoubleTap()
  }

  @available(iOS 17.5, *)
  func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
    emitDoubleTap()
  }
}
