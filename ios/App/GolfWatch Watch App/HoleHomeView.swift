import SwiftUI

/// Main read view shown when a round is active. Three vertical bands:
///   • Top: hole # + par badge + course name (small caption)
///   • Middle: huge distance-to-pin readout (yards / feet) + score-vs-par
///   • Bottom: prev / next hole controls and the "Record Shot" entry
struct HoleHomeView: View {
    @EnvironmentObject var session: WatchSession
    @State private var showingShotFlow = false

    var body: some View {
        let s = session.state

        VStack(spacing: 6) {
            // --- Header ---
            HStack(spacing: 6) {
                Text("Hole \(s.holeNumber.map(String.init) ?? "—")")
                    .font(.headline)
                Spacer()
                if let par = s.par {
                    Text("Par \(par)")
                        .font(.caption2)
                        .fontWeight(.bold)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.yellow.opacity(0.25))
                        .clipShape(Capsule())
                }
            }
            if let name = s.courseName {
                Text(name)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            // --- Big distance read ---
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(distanceText(s))
                    .font(.system(size: 44, weight: .heavy, design: .rounded))
                    .minimumScaleFactor(0.6)
                Text(distanceUnit(s))
                    .font(.title3)
                    .foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 4)

            // --- Score pill ---
            if let diff = s.scoreVsPar {
                Text(diff)
                    .font(.title3)
                    .fontWeight(.heavy)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Color.green.opacity(0.6))
                    .clipShape(Capsule())
            }

            Spacer(minLength: 4)

            // --- Controls ---
            HStack(spacing: 6) {
                Button {
                    session.send(.navigateHole(direction: "prev"))
                } label: {
                    Image(systemName: "chevron.left")
                        .frame(maxWidth: .infinity)
                }
                .controlSize(.small)

                Button {
                    showingShotFlow = true
                } label: {
                    Image(systemName: "plus")
                        .fontWeight(.bold)
                        .frame(maxWidth: .infinity)
                }
                .controlSize(.small)
                .tint(.green)

                Button {
                    session.send(.navigateHole(direction: "next"))
                } label: {
                    Image(systemName: "chevron.right")
                        .frame(maxWidth: .infinity)
                }
                .controlSize(.small)
            }

            // Reachability hint when phone is offline — actions queue via
            // transferUserInfo so they'll deliver eventually, but the user
            // should know it's not real-time.
            if !session.reachable {
                Text("Phone offline — queued")
                    .font(.system(size: 9))
                    .foregroundColor(.orange)
            }
        }
        .padding(.horizontal, 6)
        .sheet(isPresented: $showingShotFlow) {
            ShotRecordFlow(isPresented: $showingShotFlow)
                .environmentObject(session)
        }
    }

    // Prefer feet when the phone sent a feet reading (on/near the green);
    // fall back to yards otherwise. "—" when neither is known.
    private func distanceText(_ s: WatchRoundState) -> String {
        if let ft = s.distanceFeet { return "\(ft)" }
        if let yd = s.distanceYards { return "\(yd)" }
        return "—"
    }

    private func distanceUnit(_ s: WatchRoundState) -> String {
        if s.distanceFeet != nil { return "ft" }
        return "yds"
    }
}
