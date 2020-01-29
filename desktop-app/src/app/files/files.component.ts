import { Component, OnInit, ViewChild } from '@angular/core';
import { AdbClientService, ConnectionStatus } from '../adb-client.service';
import { AppService } from '../app.service';
import { LoadingSpinnerService } from '../loading-spinner.service';
import { StatusBarService } from '../status-bar.service';
import { ProcessBucketService } from '../process-bucket.service';
interface FileFolderListing {
    name: string;
    icon: string;
    size: number;
    time: Date;
    filePath: string;
}
interface BreadcrumbListing {
    name: string;
    path: string;
}
declare let M;
@Component({
    selector: 'app-files',
    templateUrl: './files.component.html',
    styleUrls: ['./files.component.css'],
})
export class FilesComponent implements OnInit {
    @ViewChild('filesModal', { static: false }) filesModal;
    @ViewChild('fixedAction', { static: false }) fixedAction;
    @ViewChild('downloadMediaModal', { static: false }) downloadMediaModal;
    files: FileFolderListing[] = [];
    selectedFiles: FileFolderListing[] = [];
    filesToBeSaved: FileFolderListing[];
    filesToBeDeleted: FileFolderListing[];
    breadcrumbs: BreadcrumbListing[] = [];
    isOpen: boolean = false;
    currentPath: string;
    folderName: string;
    confirmMessage: string;
    currentFile: FileFolderListing;
    quickSaveModels: string[] = ['Quest', 'Go'];
    constructor(
        public spinnerService: LoadingSpinnerService,
        public adbService: AdbClientService,
        public appService: AppService,
        public statusService: StatusBarService,
        private processService: ProcessBucketService
    ) {
        this.appService.resetTop();
        appService.filesComponent = this;
        appService.isFilesOpen = true;
        appService.webService.isWebviewOpen = false;
    }
    ngOnAfterViewInit() {
        M.FloatingActionButton.init(this.fixedAction.nativeElement, {});
    }
    ngOnInit() {
        this.appService.setTitle('Headset Files');
    }
    async makeFolder() {
        if (
            ~this.files
                .filter(f => f.icon === 'folder')
                .map(f => f.name)
                .indexOf(this.folderName)
        ) {
            return this.statusService.showStatus('A folder already exists with that name!!', true);
        } else {
            await this.adbService.makeDirectory(this.appService.path.posix.join(this.currentPath, this.folderName)).then(r => {
                this.folderName = '';
                this.open(this.currentPath);
            });
        }
    }
    selectFile(event: Event, file: FileFolderListing) {
        let fileElement = event.target as Element;

        if (file.icon === 'folder' && !fileElement.classList.contains('save-icon')) {
            this.selectedFiles.length = 0;
            this.open(this.appService.path.posix.join(this.currentPath, file.name));
        } else if (!fileElement.classList.contains('delete') && !fileElement.classList.contains('save-icon')) {
            while (!fileElement.classList.contains('file')) {
                fileElement = fileElement.parentElement;
            }

            if (this.selectedFiles.includes(file)) {
                this.selectedFiles.splice(this.selectedFiles.indexOf(file), 1);
                fileElement.classList.remove('selected');
            } else {
                this.selectedFiles.push(file);
                fileElement.classList.add('selected');
            }
        }
    }
    clearSelection(file?: FileFolderListing) {
        if (file) {
            document
                .querySelectorAll('.file')
                .item(this.files.indexOf(file))
                .classList.remove('selected');
        } else {
            document.querySelectorAll('.selected').forEach(element => {
                console.log(element);
                element.classList.remove('selected');
            });
        }
    }
    async uploadFolder(folder, files, task) {
        task.status = 'Restoring Folder... ' + folder;
        if (this.appService.fs.existsSync(folder)) {
            this.adbService.localFiles = [];
            await this.adbService
                .getLocalFoldersRecursive(folder)
                .then(() => {
                    this.adbService.localFiles.forEach(file => {
                        file.savePath = this.appService.path.posix.join(
                            this.currentPath,
                            file.name
                                .replace(folder, this.appService.path.basename(folder))
                                .split('\\')
                                .join('/')
                        );
                    });
                    return this.adbService.uploadFile(this.adbService.localFiles.filter(f => f.__isFile), task);
                })
                .then(() => setTimeout(() => this.uploadFile(files, task), 500));
        }
    }
    uploadFile(files, task): Promise<any> {
        if (!files.length) return Promise.resolve();
        let f = files.shift();
        let savePath = this.appService.path.posix.join(this.currentPath, this.appService.path.basename(f));
        if (!this.appService.fs.existsSync(f)) {
            return Promise.resolve().then(() => setTimeout(() => this.uploadFile(files, task), 500));
        }
        if (this.appService.fs.lstatSync(f).isDirectory()) {
            return new Promise(async resolve => {
                this.folderName = this.appService.path.basename(f);
                await this.makeFolder();
                await this.uploadFolder(f, files, task);
                resolve();
            });
        }
        return this.adbService
            .adbCommand('push', { serial: this.adbService.deviceSerial, path: f, savePath }, stats => {
                task.status =
                    'File uploading: ' +
                    this.appService.path.basename(f) +
                    ' ' +
                    Math.round((stats.bytesTransferred / 1024 / 1024) * 100) / 100 +
                    'MB';
            })
            .then(() => setTimeout(() => this.uploadFile(files, task), 500));
    }
    uploadFilesFromList(files: string[]) {
        if (files !== undefined && files.length) {
            return this.processService.addItem('restore_files', async task => {
                task.status = 'Starting Upload to ' + this.currentPath;
                this.uploadFile(files, task)
                    .then(() => {
                        setTimeout(() => {
                            this.open(this.currentPath);
                            task.status = 'Upload complete! ' + this.currentPath;
                            this.statusService.showStatus('Files/Folders uploaded successfully!');
                        }, 1500);
                    })
                    .catch(e => this.statusService.showStatus(e.toString(), true));
            });
        }
    }
    uploadFiles() {
        this.appService.electron.remote.dialog.showOpenDialog(
            {
                properties: ['openFile', 'multiSelections'],
                defaultPath: this.adbService.savePath,
            },
            files => this.uploadFilesFromList(files)
        );
    }
    quickSaveSupported() {
        return this.quickSaveModels.includes(this.adbService.deviceModel);
    }
    async downloadMedia() {
        let paths = [];
        if (this.adbService.deviceModel === 'Quest' || this.adbService.deviceModel === 'Go') {
            paths = ['/sdcard/Oculus/Screenshots', '/sdcard/Oculus/VideoShots'];
        }

        let media: FileFolderListing[] = [];

        for (const path of paths) {
            await this.readdir(path).then(dirContents => {
                media = media.concat(dirContents.filter(file => file.icon !== 'folder'));
            });
        }

        this.saveFiles(media);
    }
    deleteFiles(files: FileFolderListing[]) {
        for (const file of files) {
            this.deleteFile(file);
        }

        this.statusService.showStatus(files.length + ' Item(s) Deleted!!');
    }
    deleteFile(file: FileFolderListing) {
        this.adbService
            .adbCommand('shell', { serial: this.adbService.deviceSerial, command: 'rm "' + file.filePath + '" -r' })
            .then(r => {
                this.files.splice(this.files.indexOf(file), 1);

                if (this.selectedFiles.includes(file)) {
                    this.selectedFiles.splice(this.selectedFiles.indexOf(file));
                }
            });
    }
    async saveFiles(files: FileFolderListing[]) {
        this.filesModal.closeModal();
        this.spinnerService.showLoader();

        for (const file of this.filesToBeSaved) {
            if (file.icon !== 'folder') {
                await this.saveFile(file);
            } else {
                this.saveFolder(file);
            }
        }

        this.spinnerService.hideLoader();

        if (files[0].icon !== 'folder') {
            this.statusService.showStatus(
                (!files ? this.selectedFiles.length : files.length) + ' files saved to ' + this.adbService.savePath + '!!'
            );
        }
    }
    saveFile(file: FileFolderListing) {
        let savePath = this.appService.path.join(this.adbService.savePath, file.name);
        let path = file.filePath;
        this.spinnerService.showLoader();
        return this.adbService
            .adbCommand('pull', { serial: this.adbService.deviceSerial, path, savePath }, stats => {
                this.spinnerService.setMessage(
                    'File downloading: ' +
                        this.appService.path.basename(savePath) +
                        '<br>' +
                        Math.round(stats.bytesTransferred / 1024 / 1024) +
                        'MB'
                );
            })
            .then(file => {
                const selectedFile = Array.from(document.getElementsByClassName('selected'));
                console.log(selectedFile.filter(e => e.innerHTML.indexOf(file.name)));
            })
            .catch(e => this.statusService.showStatus(e.toString(), true));
    }
    saveFolder(file: FileFolderListing) {
        this.filesModal.closeModal();
        let savePath = this.appService.path.join(this.adbService.savePath, file.name);
        let path = file.filePath;
        this.adbService.files = [];
        return this.processService.addItem('save_files', async task => {
            return this.adbService
                .getFoldersRecursive(path)
                .then(() => this.appService.mkdir(savePath))
                .then(
                    () =>
                        (this.adbService.files = this.adbService.files.map(f => {
                            f.saveName = this.appService.path.join(savePath, f.name.replace(path, ''));
                            return f;
                        }))
                )
                .then(() => this.adbService.makeFolder(this.adbService.files.filter(f => !f.__isFile)))
                .then(() => this.adbService.downloadFile(this.adbService.files.filter(f => f.__isFile), task))
                .then(() => this.statusService.showStatus('Folder Saved OK!'));
        });
    }
    pickLocation() {
        this.appService.electron.remote.dialog.showOpenDialog(
            {
                properties: ['openDirectory'],
                defaultPath: this.adbService.savePath,
            },
            files => {
                if (files !== undefined && files.length === 1) {
                    this.adbService.savePath = files[0];
                    this.adbService.setSavePath();
                }
            }
        );
    }
    isConnected() {
        let isConnected = this.adbService.deviceStatus === ConnectionStatus.CONNECTED;
        if (isConnected && !this.isOpen) {
            this.isOpen = true;
            this.open('/sdcard/');
        }
        return isConnected;
    }
    getCrumb(path: string) {
        let parts = path.split('/');
        let name = parts.pop();
        let parentPath = parts.join('/');
        if (parts.length > 0) {
            this.getCrumb(parentPath);
        }
        this.breadcrumbs.push({ path, name });
    }
    open(path: string) {
        this.spinnerService.showLoader();
        this.spinnerService.setMessage('Loading files...');
        this.currentPath = path;
        this.breadcrumbs = [];
        this.selectedFiles.length = 0;
        this.getCrumb(
            this.currentPath
                .split('/')
                .filter(d => d)
                .join('/')
        );
        if (!this.isConnected()) {
            return Promise.resolve();
        }
        this.readdir(path).then(dirContents => {
            this.files = dirContents;
            this.files.sort(function(a, b) {
                let textA = a.name.toUpperCase();
                let textB = b.name.toUpperCase();
                return textA < textB ? -1 : textA > textB ? 1 : 0;
            });
            this.files = this.files.filter(d => d.icon === 'folder').concat(this.files.filter(d => d.icon !== 'folder'));
            this.spinnerService.hideLoader();
        });
    }
    openSaveLocation() {
        this.appService.electron.remote.shell.openItem(this.adbService.savePath);
    }
    async readdir(path: String) {
        let dirContents: FileFolderListing[];
        await this.adbService.adbCommand('readdir', { serial: this.adbService.deviceSerial, path }).then(files => {
            dirContents = files.map(file => {
                let name = file.name;
                let size = Math.round((file.size / 1024 / 1024) * 100) / 100;
                let time = file.mtime;
                let filePath = this.appService.path.posix.join(path, file.name);
                let icon = 'folder';
                if (file.__isFile) {
                    let fileParts = file.name.split('.');
                    let extension = (fileParts[fileParts.length - 1] || '').toLowerCase();
                    switch (extension) {
                        case 'gif':
                        case 'png':
                        case 'jpeg':
                        case 'jpg':
                            icon = 'photo';
                            break;
                        case 'wav':
                        case 'ogg':
                        case 'mp3':
                            icon = 'music_note';
                            break;
                        case 'avi':
                        case 'mp4':
                            icon = 'ondemand_video';
                            break;
                        case 'txt':
                        case 'docx':
                        case 'doc':
                            icon = 'receipt';
                            break;
                        case 'pptx':
                        case 'ppt':
                            icon = 'picture_in_picture';
                            break;
                        case 'xlsx':
                        case 'xls':
                            icon = 'grid_on';
                            break;
                        default:
                            icon = 'receipt';
                            break;
                    }
                }
                return { name, icon, size, time, filePath };
            });
        });
        return dirContents;
    }
}
