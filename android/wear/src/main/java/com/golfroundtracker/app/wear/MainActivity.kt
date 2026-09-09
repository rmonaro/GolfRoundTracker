package com.golfroundtracker.app.wear

import android.Manifest
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

class MainActivity : ComponentActivity() {

    private val model: RoundViewModel by viewModels()

    /**
     * Location is requested from the ACTIVITY, not the composable.
     *
     * The watch measuring its own distance is the point of the round screen (see
     * RoundViewModel), so the permission is asked for on arrival rather than
     * behind a button — a golfer who has to discover why the yardage is stale
     * has already lost the hole. Denial is not fatal: the screen falls back to
     * the phone's last figure and says so.
     */
    private val requestLocation = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> model.onPermissionResult(granted) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { WearApp(model) }
        readLastKnownState()
        if (!model.hasLocationPermission.value) {
            requestLocation.launch(Manifest.permission.ACCESS_FINE_LOCATION)
        }
    }

    /**
     * Read the phone's most recent push directly, rather than waiting for the
     * next one.
     *
     * A DataClient item persists on the node until it is overwritten, so the
     * last state the phone sent is sitting there whether or not this process was
     * alive when it arrived. Without this, opening the watch app between pushes
     * shows an empty screen until the phone's next state change — which, on a
     * hole where nothing is happening, can be minutes.
     *
     * This is the Wear equivalent of reading `WCSession.receivedApplicationContext`
     * at launch, and it exists for exactly the same reason.
     */
    private fun readLastKnownState() {
        lifecycleScope.launch {
            try {
                val items = Wearable.getDataClient(this@MainActivity)
                    .getDataItems(
                        android.net.Uri.Builder()
                            .scheme("wear")
                            .path(WearProtocol.ROUND_STATE_PATH)
                            .build()
                    )
                    .await()
                items.use { buffer ->
                    for (item in buffer) {
                        val map = DataMapItem.fromDataItem(item).dataMap
                        val json = map.getString(WearProtocol.KEY_STATE_JSON) ?: continue
                        RoundStateStore.update(RoundState.fromJson(json))
                    }
                }
            } catch (err: Throwable) {
                // No phone in range, no Play services, nothing ever sent: all
                // normal. The UI already has a "waiting for phone" state and
                // that is a better answer than an error nobody can act on.
                android.util.Log.w("WearMain", "could not read last round state", err)
            }
        }
    }
}
