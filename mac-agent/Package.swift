// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "LockedAgentMac",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(
            name: "LockedAgentMac",
            path: "Sources/LockedAgentMac"
        )
    ]
)
