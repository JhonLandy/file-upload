
import './FileList.css';

export default {

    functional: true,
    
    props: {
        fileList: {
            type: Array,
            default: () => []
        },
        isUplod: {
            type: Boolean,
            default: false
        }
    },
    
    render(_, {props}) {

        const {fileList} = props
        return (<section class={"list"}>
            <ul>
                {fileList.map(file =>  
                    (<li class={"item"}>
                        <p class={'file-name'}>{file.name}</p>
                        {
                            file.uploading 
                            ? <progress class={'upload-progress'} min="0" max="100" value={file.progress}/>
                            : ''
                        }
                        {
                            file.uploading 
                            ? (file.progress > 0 && file.progress <= 100)  
                                ? <span class="percent">已上传 {file.progress.toFixed(0)}%</span>
                                : <span class='waiting'>waiting...</span>
                            : file.progress !== 0 
                                ? file.progress >= 100
                                    ?<span class={'success'}>done!</span> 
                                    : <span class={'fail'}>fail!</span>
                                : ''
                        }
                    </li>)
                )}
            </ul>
        </section>)
    }
}
