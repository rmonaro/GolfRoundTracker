package com.golfroundtracker.app.wear

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text

/**
 * The green. Feet to the flag, adjustable, then Missed or Made.
 *
 * WHY THE ± STEPPERS EXIST, and why the number is not simply the GPS reading:
 * GPS cannot measure a putt. Two fixes eight feet apart are well inside the
 * error of either, so the distance shown starts from the watch's estimate and
 * the GOLFER's correction is what gets recorded. For a putt their eyes are the
 * better instrument, and the message carries `distanceFeet` as authoritative
 * because of it.
 */
@Composable
fun PuttScreen(
    feet: Int?,
    sending: Boolean,
    onAdjust: (Int) -> Unit,
    onRecord: (made: Boolean) -> Unit
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
        modifier = Modifier.fillMaxSize().padding(horizontal = 8.dp)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            StepButton("−", enabled = (feet ?: 0) > 0) { onAdjust(-1) }
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.weight(1f)
            ) {
                Text(
                    text = feet?.let { "$it ft" } ?: "—",
                    style = MaterialTheme.typography.display2
                )
                Text(
                    text = "TO FLAG",
                    style = MaterialTheme.typography.caption3,
                    color = MaterialTheme.colors.onSurfaceVariant
                )
            }
            StepButton("+") { onAdjust(1) }
        }

        // Well separated, and both disabled while a send is in flight. A
        // fat-fingered "Missed" that lands on "Made" holes the player out; a
        // double-tap that fires twice records a putt they never took. Both are
        // corrections the golfer then has to make on the phone, mid-round.
        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp)
        ) {
            Chip(
                onClick = { onRecord(false) },
                enabled = !sending,
                label = { Text("Missed", style = MaterialTheme.typography.button) },
                colors = ChipDefaults.secondaryChipColors(),
                modifier = Modifier.weight(1f)
            )
            Chip(
                onClick = { onRecord(true) },
                enabled = !sending,
                label = { Text("Made", style = MaterialTheme.typography.button) },
                colors = ChipDefaults.primaryChipColors(),
                modifier = Modifier.weight(1f)
            )
        }
    }
}

@Composable
private fun StepButton(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Chip(
        onClick = onClick,
        enabled = enabled,
        label = { Text(label, style = MaterialTheme.typography.title2) },
        colors = ChipDefaults.secondaryChipColors(),
        modifier = Modifier.size(44.dp)
    )
}
