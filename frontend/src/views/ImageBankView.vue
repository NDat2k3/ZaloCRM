<template>
  <div class="pa-4" style="max-width: 1100px; margin: 0 auto;">
    <!-- Header -->
    <v-card class="mb-4" variant="flat" border>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" color="primary">mdi-image-multiple</v-icon>
        Kho ảnh chatbot
      </v-card-title>
      <v-card-text class="text-body-2 text-medium-emphasis">
        Tải ảnh lên đây để lấy <strong>link công khai</strong>, rồi dán link vào câu trả lời trong Dify
        theo dạng <code>[[IMG]] &lt;link&gt;</code> — bot sẽ tự gửi ảnh kèm câu trả lời.
      </v-card-text>
    </v-card>

    <!-- Upload zone -->
    <v-card class="mb-4" variant="flat" border>
      <v-card-text>
        <v-file-input
          v-model="files"
          label="Chọn ảnh (jpg/png/webp/gif, tối đa 20MB)"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          chips
          show-size
          prepend-icon="mdi-camera"
          density="comfortable"
          :disabled="uploading"
        />
        <v-btn
          color="primary"
          :loading="uploading"
          :disabled="!files || files.length === 0"
          prepend-icon="mdi-cloud-upload"
          @click="upload"
        >
          Tải lên
        </v-btn>
      </v-card-text>
    </v-card>

    <!-- Gallery -->
    <v-card variant="flat" border>
      <v-card-title class="text-body-1 d-flex align-center">
        Ảnh trong kho ({{ images.length }})
        <v-spacer />
        <v-btn variant="text" size="small" prepend-icon="mdi-refresh" :loading="loading" @click="loadImages">
          Tải lại
        </v-btn>
      </v-card-title>
      <v-card-text>
        <div v-if="!loading && images.length === 0" class="text-center text-medium-emphasis py-8">
          Chưa có ảnh nào. Tải ảnh lên ở trên nhé.
        </div>
        <v-row>
          <v-col v-for="img in images" :key="img.key" cols="6" sm="4" md="3">
            <v-card variant="outlined">
              <v-img :src="img.url" height="140" cover>
                <template #placeholder>
                  <div class="d-flex align-center justify-center fill-height">
                    <v-progress-circular indeterminate size="24" />
                  </div>
                </template>
              </v-img>
              <v-card-text class="py-2 px-2">
                <div class="text-caption text-medium-emphasis mb-1">{{ formatSize(img.size) }}</div>
                <div class="d-flex">
                  <v-btn size="x-small" variant="tonal" color="primary" prepend-icon="mdi-content-copy" @click="copyUrl(img.url)">
                    Copy link
                  </v-btn>
                  <v-spacer />
                  <v-btn size="x-small" variant="text" color="error" icon="mdi-delete" @click="remove(img)" />
                </div>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-snackbar v-model="snack.show" :color="snack.color" :timeout="2500">{{ snack.text }}</v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api';

interface BankImage { key: string; url: string; size: number; lastModified: string }

const files = ref<File[]>([]);
const images = ref<BankImage[]>([]);
const loading = ref(false);
const uploading = ref(false);
const snack = ref({ show: false, text: '', color: 'success' });

function showSnack(text: string, color = 'success') {
  snack.value = { show: true, text, color };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function loadImages() {
  loading.value = true;
  try {
    const res = await api.get('/image-bank');
    images.value = res.data.images ?? [];
  } catch {
    showSnack('Không tải được danh sách ảnh', 'error');
  } finally {
    loading.value = false;
  }
}

async function upload() {
  if (!files.value || files.value.length === 0) return;
  uploading.value = true;
  try {
    const form = new FormData();
    for (const f of files.value) form.append('file', f);
    const res = await api.post('/image-bank/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
    const n = res.data.uploaded?.length ?? 0;
    showSnack(`Đã tải lên ${n} ảnh`);
    files.value = [];
    await loadImages();
  } catch (e: any) {
    showSnack(e?.response?.data?.error ?? 'Tải lên thất bại', 'error');
  } finally {
    uploading.value = false;
  }
}

async function copyUrl(url: string) {
  await navigator.clipboard.writeText(url);
  showSnack('Đã copy link ảnh');
}

async function remove(img: BankImage) {
  try {
    await api.post('/image-bank/delete', { key: img.key });
    images.value = images.value.filter((i) => i.key !== img.key);
    showSnack('Đã xóa ảnh');
  } catch {
    showSnack('Xóa thất bại', 'error');
  }
}

onMounted(loadImages);
</script>
