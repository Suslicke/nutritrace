package com.nutritrace.app

import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Health Connect's background-read permission (#294). Without it, Health
 * Connect answers reads only while NutriTrace is in front, so the hourly
 * worker (HealthConnectSyncWorker) can't read with the app closed.
 * developer.android.com, Health Connect, "Read data": declare
 * READ_HEALTH_DATA_IN_BACKGROUND, check FEATURE_READ_HEALTH_DATA_IN_BACKGROUND,
 * and ask for it like any other Health Connect permission.
 *
 * The Capacitor Health Connect plugin can only ask for record types, so this
 * asks for this one permission with Health Connect's own request screen.
 *
 * status()  -> { available, granted }
 * request() -> the same, after the user answered (only when available and
 *              not granted yet; otherwise it answers straight away).
 */
@CapacitorPlugin(name = "HealthBackground")
class HealthBackgroundPlugin : Plugin() {
    companion object {
        const val PERMISSION = HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND

        /** Whether this phone's Health Connect can grant background reads. */
        fun available(client: HealthConnectClient): Boolean = try {
            client.features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND) ==
                HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
        } catch (_: Exception) {
            false
        }
    }

    private val scope = CoroutineScope(Dispatchers.Main)
    private val contract = PermissionController.createRequestPermissionResultContract()

    private fun client(): HealthConnectClient? =
        if (HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE) HealthConnectClient.getOrCreate(context) else null

    private fun answer(call: PluginCall, available: Boolean, granted: Boolean) {
        call.resolve(JSObject().apply {
            put("available", available)
            put("granted", granted)
        })
    }

    private fun resolveStatus(call: PluginCall) {
        val client = client() ?: return answer(call, false, false)
        if (!available(client)) return answer(call, false, false)
        scope.launch {
            val granted = try {
                client.permissionController.getGrantedPermissions().contains(PERMISSION)
            } catch (_: Exception) { false }
            answer(call, true, granted)
        }
    }

    @PluginMethod
    fun status(call: PluginCall) = resolveStatus(call)

    @PluginMethod
    fun request(call: PluginCall) {
        val client = client() ?: return answer(call, false, false)
        if (!available(client)) return answer(call, false, false)
        scope.launch {
            val granted = try {
                client.permissionController.getGrantedPermissions().contains(PERMISSION)
            } catch (_: Exception) { false }
            if (granted) return@launch answer(call, true, true)
            try {
                startActivityForResult(call, contract.createIntent(context, setOf(PERMISSION)), "onRequestResult")
            } catch (e: Exception) {
                call.reject("Could not open Health Connect: ${e.message}")
            }
        }
    }

    @ActivityCallback
    private fun onRequestResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        // The screen's answer can lag what Health Connect stores, so ask it.
        resolveStatus(call)
    }
}
