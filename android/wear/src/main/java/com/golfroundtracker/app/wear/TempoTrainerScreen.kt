package com.golfroundtracker.app.wear

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text

@Composable
fun TempoTrainerScreen(onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val trainer = remember { TempoTrainer(context) }
    val running by trainer.running.collectAsStateWithLifecycle()
    val backswing by trainer.backswingSeconds.collectAsStateWithLifecycle()
    val beat by trainer.beat.collectAsStateWithLifecycle()

    // Stop with the screen. A metronome buzzing against a wrist the golfer has
    // walked away from is the kind of thing that gets an app deleted.
    DisposableEffect(Unit) { onDispose { trainer.stop() } }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
        modifier = Modifier.fillMaxSize().padding(horizontal = 10.dp)
    ) {
        Text(
            text = beat.ifEmpty { "Tempo" },
            style = MaterialTheme.typography.title1
        )
        Text(
            // Both halves shown: the ratio is the point, the duration is what
            // the golfer is setting.
            text = "${"%.1f".format(backswing)}s : ${"%.2f".format(backswing / 3)}s",
            style = MaterialTheme.typography.caption2,
            color = MaterialTheme.colors.onSurfaceVariant
        )

        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Chip(
                onClick = { trainer.adjust(-0.1) },
                label = { Text("−", style = MaterialTheme.typography.title2) },
                colors = ChipDefaults.secondaryChipColors(),
                modifier = Modifier.size(44.dp)
            )
            Chip(
                onClick = { trainer.toggle(scope) },
                label = {
                    Text(
                        if (running) "Stop" else "Start",
                        style = MaterialTheme.typography.button
                    )
                },
                colors = if (running) ChipDefaults.secondaryChipColors()
                else ChipDefaults.primaryChipColors(),
                modifier = Modifier.weight(1f)
            )
            Chip(
                onClick = { trainer.adjust(0.1) },
                label = { Text("+", style = MaterialTheme.typography.title2) },
                colors = ChipDefaults.secondaryChipColors(),
                modifier = Modifier.size(44.dp)
            )
        }

        Chip(
            onClick = onClose,
            label = { Text("Back", style = MaterialTheme.typography.button) },
            colors = ChipDefaults.secondaryChipColors(),
            modifier = Modifier.padding(top = 8.dp)
        )
    }
}
