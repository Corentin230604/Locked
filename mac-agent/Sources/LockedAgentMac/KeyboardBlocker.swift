import Cocoa

/// Global low-level keyboard event tap that swallows the shortcuts students
/// would normally use to escape a fullscreen app: Cmd+Tab, Cmd+Q, Cmd+H
/// (hide), Cmd+M (minimize). Requires the Accessibility permission — silently
/// does nothing if it isn't granted, same fail-open-safe posture as leaving
/// Ctrl+Alt+Del alone on Windows (some system-reserved shortcuts, like
/// Cmd+Space for Spotlight, may still not be blockable without an MDM
/// profile — a real macOS platform limitation, not a bug here).
final class KeyboardBlocker {
    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?

    func install() {
        guard AXIsProcessTrusted() else {
            NSLog("Locked: Accessibility permission not granted — keyboard blocking disabled")
            return
        }

        let mask = CGEventMask(1 << CGEventType.keyDown.rawValue)
        let callback: CGEventTapCallBack = { proxy, type, event, refcon in
            guard let refcon = refcon else { return Unmanaged.passRetained(event) }
            let blocker = Unmanaged<KeyboardBlocker>.fromOpaque(refcon).takeUnretainedValue()
            return blocker.handle(type: type, event: event)
        }

        let selfPointer = Unmanaged.passUnretained(self).toOpaque()
        eventTap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: mask,
            callback: callback,
            userInfo: selfPointer
        )

        guard let eventTap = eventTap else {
            NSLog("Locked: failed to create keyboard event tap")
            return
        }

        runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
        CGEvent.tapEnable(tap: eventTap, enable: true)
    }

    private func handle(type: CGEventType, event: CGEvent) -> Unmanaged<CGEvent>? {
        guard type == .keyDown else { return Unmanaged.passRetained(event) }

        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        let cmdDown = event.flags.contains(.maskCommand)

        // kVK_Tab=0x30, kVK_ANSI_Q=0x0C, kVK_ANSI_H=0x04, kVK_ANSI_M=0x2E
        let blockedKeys: Set<Int64> = [0x30, 0x0C, 0x04, 0x2E]

        if cmdDown && blockedKeys.contains(keyCode) {
            return nil  // non-nil return would pass the event through — nil swallows it
        }
        return Unmanaged.passRetained(event)
    }

    func uninstall() {
        if let eventTap = eventTap {
            CGEvent.tapEnable(tap: eventTap, enable: false)
        }
        if let runLoopSource = runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
        }
        eventTap = nil
        runLoopSource = nil
    }
}
