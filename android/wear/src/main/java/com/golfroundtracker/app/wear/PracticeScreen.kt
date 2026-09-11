package com.golfroundtracker.app.wear

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text

/**
 * Practice mode on the wrist.
 *
 * Shows the swing COUNT and the last swing's headline numbers, and nothing
 * else. Tempo and a 0-100 effort score are the two things a golfer can act on
 * between swings; a full metric dump on a 1.7" screen is a thing to squint at,
 * not to use. The rest of the bundle goes to the phone, where there is room to
 * render it and history to compare it against.
 */
@Composable
fun PracticeScreen(onEnd: () -> Unit) {
    val context = LocalContext.current
    val count by PracticeSession.swingCount(context).collectAsStateWithLifecycle()
    val last by PracticeSession.lastSwing(context).collectAsStateWithLifecycle()

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
        modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp)
    ) {
        Text(
            text = "$count",
            style = MaterialTheme.typography.display1
        )
        Text(
            text = if (count == 1) "swing" else "swings",
            style = MaterialTheme.typography.caption2,
            color = MaterialTheme.colors.onSurfaceVariant
        )

        last?.let { m ->
            Text(
                text = if (m.isAirSwing) {
                    // Said plainly rather than hidden. A rehearsal still gets
                    // measured, but a golfer comparing tempo across swings needs
                    // to know which ones had a ball in front of them.
                    "practice swing"
                } else {
                    "${m.swingType} · tempo ${m.tempoRatio}"
                },
                style = MaterialTheme.typography.caption2,
                color = MaterialTheme.colors.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 6.dp)
            )
            Text(
                // "Effort", never "speed" — this is a wrist-derived 0-100
                // relative score and calling it mph would be a measurement the
                // hardware cannot make.
                text = "effort ${m.estimatedHandSpeed}",
                style = MaterialTheme.typography.title3
            )
        }

        Chip(
            onClick = onEnd,
            label = { Text("End", style = MaterialTheme.typography.button) },
            colors = ChipDefaults.secondaryChipColors(),
            modifier = Modifier.padding(top = 10.dp)
        )
    }
}
