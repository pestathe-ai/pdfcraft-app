plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val buildNumber = (System.getenv("BUILD_NUMBER") ?: "1").toInt()

android {
    namespace = "dev.pdfcraft.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.pdfcraft.app"
        minSdk = 29
        // 34: evita l'edge-to-edge forzato di Android 15 (la pagina finirebbe sotto la barra di stato)
        targetSdk = 34
        versionCode = buildNumber
        versionName = "0.1.$buildNumber"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    // Nota: gli asset .gz vengono decompressi automaticamente durante la build (soffice.*.bin):
    // vanno lasciati comprimere dall'APK, altrimenti occupano 235 MB.
    androidResources {
        noCompress += listOf("woff2", "zip")
        ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.18.0-rc01")
    testImplementation("junit:junit:4.13.2")
}
